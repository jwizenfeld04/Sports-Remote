import { useMemo, useState } from "react";
import type { Game, Settings } from "../../lib/types";
import { LEAGUES } from "../../lib/types";
import { resolveGame } from "../../lib/resolve";
import { LEAGUE_LABEL } from "../format";
import { APP_RECORD } from "../catalog";
import type { HouseholdView, TvView } from "../api";
import { Button, Icon } from "../components/ui";
import { CoveragePanel } from "./CoveragePanel";
import { contextFor, sampleGames, useCoverage, type Sample } from "./useCoverage";

// Everyone can see coverage; admins get an "Edit services" button. The game list shows, per game, where it opens
// (or why it can't), so it doubles as a "why can't I watch this?" explainer.

export function CoveragePage({ household, settings, games, tv, isAdmin, onEdit, onBack }: {
  household: HouseholdView; settings: Settings; games: Game[]; tv: TvView | null; isAdmin: boolean; onEdit: () => void; onBack: () => void;
}) {
  const [sample, setSample] = useState<Sample>("week");
  const [show, setShow] = useState<"no" | "all">("no");
  const input = { market: household.market, subscriptions: household.subscriptions, tveSignIns: household.tveSignIns, favorites: settings.favorites, platform: tv?.platform };
  const { games: measured, realLeagues } = useMemo(() => sampleGames(games, household.market.localTeams, sample), [games, household.market.localTeams, sample]);
  const { report } = useCoverage(input, measured);
  const ctx = useMemo(() => contextFor(input), [household, settings.favorites, tv?.platform]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = measured
    .filter((g) => show === "all" || report.perGame.get(g.id)?.status !== "yes")
    .sort((a, b) => LEAGUES.indexOf(a.league) - LEAGUES.indexOf(b.league) || Date.parse(a.startTime) - Date.parse(b.startTime))
    .slice(0, 150);

  return (
    <div className="app coverage-page">
      <header className="topbar">
        <div className="toolbar">
          <IconButtonBack onClick={onBack} />
          <h1 className="page-title">Coverage</h1>
          <span className="grow" />
          {isAdmin && <Button variant="primary" onClick={onEdit} data-testid="edit-services">Edit services</Button>}
        </div>
      </header>
      <main className="content coverage-content">
        <CoveragePanel report={report} sample={sample} onSample={setSample} realLeagues={realLeagues} onAdd={isAdmin ? () => onEdit() : undefined} />
        <section className="cov-games">
          <div className="cov-games-head">
            <h2>{show === "no" ? "Games you can't (or might not) watch" : "Every game"}</h2>
            <Button variant="ghost" onClick={() => setShow(show === "no" ? "all" : "no")}>{show === "no" ? "Show all" : "Only gaps"}</Button>
          </div>
          {rows.length === 0 && <p className="muted">Nothing missing. Every game in this sample is on your services.</p>}
          <ul className="cov-game-list">
            {rows.map((g) => {
              const r = resolveGame(g, ctx);
              const st = report.perGame.get(g.id)?.status ?? "no";
              return (
                <li key={g.id} className={`cov-game ${st}`}>
                  <span className={`cov-dot ${st}`} aria-label={st === "yes" ? "Watchable" : st === "maybe" ? "Probably" : "Not watchable"} />
                  <span className="cov-game-league">{LEAGUE_LABEL[g.league]}</span>
                  <span className="cov-game-teams">{g.away.name} at {g.home.name}</span>
                  <span className="cov-game-nets muted small">{g.broadcasts.filter((b) => !b.radio).map((b) => b.raw).join(", ") || "TBD"}</span>
                  <span className="cov-game-why small">
                    {r.routes[0] ? <>{APP_RECORD[r.routes[0].service]?.label}{r.routes[0].certain ? "" : " (probably)"}</> : r.notCovered?.message}
                  </span>
                </li>
              );
            })}
          </ul>
          {realLeagues.length < LEAGUES.length && sample === "week" && <p className="muted small"><Icon name="info" size={14} /> Leagues without games listed this week use a typical week.</p>}
        </section>
      </main>
    </div>
  );
}

function IconButtonBack({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="icon-btn" aria-label="Back to games" onClick={onClick}>
      <Icon name="back" />
    </button>
  );
}
