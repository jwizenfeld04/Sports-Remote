import type { League } from "../../lib/types";
import { LEAGUES } from "../../lib/types";
import type { CoverageReport } from "../../lib/coverage";
import { LEAGUE_LABEL } from "../format";
import { Segmented } from "../components/ui";
import type { Sample } from "./useCoverage";

// The "can I watch what I care about?" summary: a ring for everything, a bar per league and per favorite
// team, and the biggest gaps with the subscription that would close each one.

const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);

function Ring({ yes, maybe, total, size = 112 }: { yes: number; maybe: number; total: number; size?: number }) {
  const r = 15.9155; // circumference 100
  const y = total ? (100 * yes) / total : 0;
  const m = total ? (100 * maybe) / total : 0;
  return (
    <svg className="cov-ring" width={size} height={size} viewBox="0 0 36 36" role="img" aria-label={`${pct(yes, total)}% watchable${maybe ? `, ${pct(maybe, total)}% probably` : ""}`}>
      <circle className="cov-ring-track" cx="18" cy="18" r={r} />
      <circle className="cov-ring-maybe" cx="18" cy="18" r={r} strokeDasharray={`${y + m} ${100 - y - m}`} strokeDashoffset="25" />
      <circle className="cov-ring-yes" cx="18" cy="18" r={r} strokeDasharray={`${y} ${100 - y}`} strokeDashoffset="25" />
      <text x="18" y="17.5" className="cov-ring-num">{pct(yes + maybe, total)}%</text>
      <text x="18" y="23" className="cov-ring-sub">of games</text>
    </svg>
  );
}

function Bar({ yes, maybe, total }: { yes: number; maybe: number; total: number }) {
  return (
    <span className="cov-bar" aria-hidden>
      <span className="cov-bar-yes" style={{ width: `${pct(yes, total)}%` }} />
      <span className="cov-bar-maybe" style={{ width: `${pct(maybe, total)}%` }} />
    </span>
  );
}

export interface PanelProps {
  report: CoverageReport;
  sample: Sample;
  onSample: (s: Sample) => void;
  realLeagues: League[];
  onAdd?: (id: string, tier?: string) => void;
  compact?: boolean;
}

export function CoveragePanel({ report, sample, onSample, realLeagues, onAdd, compact }: PanelProps) {
  const leagues = LEAGUES.filter((l) => report.byLeague[l]?.total);
  return (
    <section className={`cov-panel${compact ? " compact" : ""}`} aria-label="Coverage" data-testid="coverage-panel">
      <div className="cov-head">
        <Ring yes={report.yes} maybe={report.maybe} total={report.total} size={compact ? 88 : 112} />
        <div className="cov-head-text">
          <h3>
            {report.yes + report.maybe === 0 ? "Nothing watchable yet" : `You can watch ${report.yes + report.maybe} of ${report.total} games`}
          </h3>
          <p className="muted small">
            {sample === "week"
              ? realLeagues.length
                ? `This week's schedule for ${realLeagues.map((l) => LEAGUE_LABEL[l]).join(", ")}${realLeagues.length < leagues.length ? "; a typical week for the rest" : ""}.`
                : "A typical week (no league has a full schedule listed right now)."
              : "A typical regular-season week for every league, with your local teams playing."}
            {report.maybe > 0 && <> <span className="cov-key maybe" /> {report.maybe} probably (unconfirmed channel lineups or local station).</>}
          </p>
          <Segmented label="Games" value={sample} onChange={onSample} options={[{ value: "week", label: "This week" }, { value: "typical", label: "Typical week" }]} />
        </div>
      </div>

      <ul className="cov-leagues">
        {leagues.map((l) => {
          const b = report.byLeague[l]!;
          return (
            <li key={l}>
              <span className="cov-label">{LEAGUE_LABEL[l]}</span>
              <Bar yes={b.yes} maybe={b.maybe} total={b.total} />
              <span className="cov-num">{b.yes + b.maybe}/{b.total}</span>
            </li>
          );
        })}
      </ul>

      {report.favorites.length > 0 && (
        <>
          <h4 className="cov-sub">Your teams</h4>
          <ul className="cov-leagues">
            {report.favorites.filter((f) => f.total > 0).map((f) => (
              <li key={f.team}>
                <span className="cov-label">{f.label}</span>
                <Bar yes={f.yes} maybe={f.maybe} total={f.total} />
                <span className="cov-num">{f.yes + f.maybe}/{f.total}</span>
              </li>
            ))}
            {report.favorites.every((f) => f.total === 0) && <li className="muted small">None of your teams play in these games.</li>}
          </ul>
        </>
      )}

      {report.gaps.length > 0 && (
        <>
          <h4 className="cov-sub">What you're missing</h4>
          <ul className="cov-gaps">
            {report.gaps.slice(0, compact ? 4 : 10).map((g) => (
              <li key={g.need} className="cov-gap">
                <div className="cov-gap-head">
                  <strong>{g.need}</strong>
                  <span className="muted small">{g.games} game{g.games === 1 ? "" : "s"} · {g.examples.join(", ")}</span>
                </div>
                {g.fixes.length > 0 ? (
                  <div className="cov-fixes">
                    {g.fixes.slice(0, compact ? 2 : 4).map((f) => (
                      <button
                        key={f.id + (f.tier ?? "")}
                        type="button"
                        className={`cov-fix${f.certain ? "" : " maybe"}`}
                        disabled={!onAdd}
                        onClick={() => onAdd?.(f.id, f.tier)}
                        data-testid={`add-${f.id}`}
                        title={f.certain ? undefined : "Reported to carry it, not confirmed"}
                      >
                        <span className="cov-fix-name">{onAdd ? "+ " : ""}{f.name}</span>
                        <span className="cov-fix-meta">{f.adds > 0 ? `+${f.adds} games` : "—"}{f.price ? ` · ${f.price}` : ""}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="muted small">No US service carries this.</p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
