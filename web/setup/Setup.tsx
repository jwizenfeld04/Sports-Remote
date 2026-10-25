import { useCallback, useEffect, useMemo, useState } from "react";
import type { Game } from "../../lib/types";
import type { Market, OwnedSubscription } from "../../lib/profile";
import { api, type Boot } from "../api";
import { Button, Icon } from "../components/ui";
import { AccessStep } from "./AccessStep";
import { AreaStep, LocalStep, TeamsStep } from "./MarketSteps";
import { ServicesStep } from "./ServicesStep";
import { TvStep } from "./TvStep";
import { ExtrasStep } from "./ExtrasStep";
import { CoveragePanel } from "./CoveragePanel";
import { sampleGames, useCoverage, type Sample } from "./useCoverage";

// The setup wizard. Each step saves when you move on, so closing the page halfway keeps what's done.
// The coverage panel sits beside the steps that change it (area, teams, services, local teams).

type StepId = "access" | "area" | "teams" | "services" | "local" | "tvs" | "extras" | "done";
const STEPS: { id: StepId; title: string; lead: string }[] = [
  { id: "access", title: "Sign-in", lead: "Choose how people in your home get in." },
  { id: "area", title: "Your area", lead: "Where you watch decides your local channels, your local teams and what's blacked out." },
  { id: "teams", title: "Your teams", lead: "Favorites go first, and you'll see how many of their games you can watch." },
  { id: "services", title: "Your services", lead: "Tick what you pay for. Coverage updates as you go, and shows what each service would add." },
  { id: "local", title: "Local teams", lead: "How you watch your local teams' games, which aren't on national TV." },
  { id: "tvs", title: "Your TVs", lead: "Connect the TVs this server will control: Fire TV, Google TV or another Android TV." },
  { id: "extras", title: "Extras", lead: "Optional: Plex Live TV for antenna households, and ESPN game links." },
  { id: "done", title: "Done", lead: "Here's what you can watch." },
];
const WITH_COVERAGE: StepId[] = ["area", "teams", "services", "local", "done"];

export function Setup({ boot, onBoot, games, onDone }: { boot: Boot; onBoot: (b: Boot) => void; games: Game[]; onDone?: () => void }) {
  const steps = useMemo(() => STEPS.filter((s) => s.id !== "access" || !boot.authed), [boot.authed]);
  const [step, setStep] = useState<StepId>(steps[0].id);
  const h = boot.household;
  const [market, setMarket] = useState<Market>(h?.market ?? { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York", metro: null, localTeams: [], localSources: {} });
  const [subs, setSubs] = useState<OwnedSubscription[]>(h?.subscriptions ?? []);
  const [tve, setTve] = useState<string[]>(h?.tveSignIns ?? []);
  const [favorites, setFavorites] = useState<string[]>(boot.settings?.favorites ?? []);
  const [sample, setSample] = useState<Sample>("week");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pick up the household once signed in (after the access step).
  useEffect(() => {
    if (!boot.household) return;
    setMarket(boot.household.market);
    setSubs(boot.household.subscriptions);
    setTve(boot.household.tveSignIns);
  }, [boot.household?.setupComplete]); // eslint-disable-line react-hooks/exhaustive-deps

  const { games: measured, realLeagues } = useMemo(() => sampleGames(games, market.localTeams, sample), [games, market.localTeams, sample]);
  const { report, gain } = useCoverage({ market, subscriptions: subs, tveSignIns: tve, favorites, platform: boot.tvs?.[0]?.platform }, measured);

  const reload = useCallback(() => api.bootstrap().then(onBoot), [onBoot]);
  const i = steps.findIndex((s) => s.id === step);
  const meta = steps[i];

  const save = async (): Promise<boolean> => {
    setError(null);
    if (step === "area" || step === "services" || step === "local") {
      const r = await api.saveHousehold({ market, subscriptions: subs, tveSignIns: tve });
      if (r.status !== 200) return setError((r.data as unknown as { error?: string })?.error ?? "Couldn't save."), false;
    }
    if (step === "teams" && boot.settings) {
      const r = await api.saveSettings({ ...boot.settings, favorites });
      if (r.status !== 200) return setError("Couldn't save your teams."), false;
    }
    return true;
  };
  const next = async () => {
    setSaving(true);
    const ok = await save();
    setSaving(false);
    if (!ok) return;
    if (step === "done") {
      await api.completeSetup();
      await reload();
      onDone?.();
      return;
    }
    await reload();
    setStep(steps[Math.min(i + 1, steps.length - 1)].id);
    window.scrollTo?.({ top: 0 });
  };
  const add = (id: string, tier?: string) => {
    if (subs.some((s) => s.id === id)) setSubs(subs.map((s) => (s.id === id ? { ...s, tier: tier ?? s.tier } : s)));
    else setSubs([...subs, { id, tier, addOns: [] }]);
    if (step !== "services") setStep("services");
  };

  return (
    <div className="setup">
      <header className="setup-head">
        <div className="brand"><img className="brand-mark" src="/icon.svg" alt="" width={28} height={28} /><span className="brand-name">Sports Remote setup</span></div>
        <nav className="setup-steps" aria-label="Setup steps">
          {steps.map((s, j) => (
            <button key={s.id} type="button" className={`setup-dot${s.id === step ? " on" : ""}${j < i ? " done" : ""}`} disabled={!boot.authed} onClick={() => setStep(s.id)} aria-current={s.id === step ? "step" : undefined}>
              <span className="setup-dot-n">{j < i ? <Icon name="check" size={14} /> : j + 1}</span>
              <span className="setup-dot-label">{s.title}</span>
            </button>
          ))}
        </nav>
        {onDone && boot.household?.setupComplete && <Button variant="ghost" onClick={onDone}>Close</Button>}
      </header>

      <div className={`setup-body${WITH_COVERAGE.includes(step) ? " with-panel" : ""}`}>
        <main className="setup-main">
          <h1>{meta.title}</h1>
          <p className="setup-lead">{meta.lead}</p>
          {step === "access" && <AccessStep onDone={() => void reload().then(() => setStep("area"))} />}
          {step === "area" && <AreaStep market={market} onChange={setMarket} />}
          {step === "teams" && <TeamsStep favorites={favorites} localTeams={market.localTeams} onChange={setFavorites} />}
          {step === "services" && <ServicesStep subscriptions={subs} tveSignIns={tve} gain={gain} onChange={(s, t) => (setSubs(s), setTve(t))} />}
          {step === "local" && <LocalStep market={market} subscriptions={subs} tveSignIns={tve} onChange={setMarket} />}
          {step === "tvs" && <TvStep adbMissing={boot.capabilities?.adb === false} tvs={boot.household?.tvs ?? []} status={boot.tvs ?? []} subscriptions={subs} onChanged={reload} />}
          {step === "extras" && boot.household && <ExtrasStep household={boot.household} subscriptions={subs} onChanged={reload} />}
          {step === "done" && (
            <div className="done-step">
              <p>You're set. You can change any of this later from Settings → Services, TVs and your area.</p>
              {(boot.household?.tvs.length ?? 0) === 0 && <p className="warn small">No TV yet: games will show, but nothing can open until you add one.</p>}
            </div>
          )}
          {step !== "access" && (
            <footer className="setup-nav">
              {i > 0 && steps[i - 1].id !== "access" && <Button variant="ghost" icon="back" onClick={() => setStep(steps[i - 1].id)}>Back</Button>}
              <span className="grow" />
              {error && <span className="warn small" role="alert">{error}</span>}
              <Button variant="primary" onClick={next} disabled={saving || (step === "area" && !market.metro && market.localTeams.length === 0)} data-testid="setup-next">
                {saving ? "Saving..." : step === "done" ? "Start watching" : step === "tvs" && !(boot.household?.tvs.length) ? "Skip for now" : "Continue"}
              </Button>
            </footer>
          )}
        </main>
        {WITH_COVERAGE.includes(step) && (
          <button type="button" className="setup-mini" onClick={() => document.getElementById("setup-coverage")?.scrollIntoView({ behavior: "smooth" })}>
            <strong>{report.total ? Math.round((100 * (report.yes + report.maybe)) / report.total) : 0}%</strong>
            <span>of games watchable · see coverage</span>
          </button>
        )}
        {WITH_COVERAGE.includes(step) && (
          <aside className="setup-panel" id="setup-coverage">
            <CoveragePanel report={report} sample={sample} onSample={setSample} realLeagues={realLeagues} onAdd={add} compact={step !== "done"} />
          </aside>
        )}
      </div>
    </div>
  );
}
