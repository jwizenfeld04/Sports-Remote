import { memo, useMemo, type CSSProperties } from "react";
import type { Game, Resolution, ServiceId, TeamRef } from "../../lib/types";
import type { AppDef as ServiceDef } from "../../lib/catalog/apps";
import { NETWORK_LABEL } from "../../lib/networks";
import { cardTestId, dayLabel, LEAGUE_LABEL, QUALITY_LABEL, statusLabel, timeParts } from "../format";
import { cardColors } from "../teamColors";
import { Icon, TeamLogo } from "./ui";
import { routeLabel } from "../catalog";

interface Props {
  game: Game;
  resolution: Resolution | undefined;
  services: Record<string, ServiceDef>;
  favorite: boolean;
  onOpen: (g: Game) => void;
}

function Side({ team, side, score, trailing }: { team: TeamRef; side: "away" | "home"; score?: number | null; trailing?: boolean }) {
  return (
    <div className={`side side-${side}`}>
      <span className="side-top">
        <TeamLogo logo={team.logo} abbr={team.abbr} size={60} />
        {score !== null && <span className={`score${trailing ? " trailing" : ""}`} aria-hidden>{score ?? "–"}</span>}
      </span>
      <span className="side-text">
        <span className="side-city">{team.city || team.abbr}</span>
        <span className="side-name">{team.name}</span>
      </span>
    </div>
  );
}

export const GameCard = memo(function GameCard({ game, resolution, services, favorite, onOpen }: Props) {
  const primary = resolution?.routes[0];
  const covered = !!primary;
  const live = game.state === "in";
  const scored = game.state !== "pre";
  const networks = [...new Set(game.broadcasts.map((b) => (b.network === "local" || b.network === "unknown" ? b.raw : NETWORK_LABEL[b.network])))];
  const colors = useMemo(() => cardColors(game.away, game.home), [game.away, game.home]);
  const style = { "--away": colors.away, "--away-ink": colors.awayInk, "--home": colors.home, "--home-ink": colors.homeInk } as CSSProperties;
  const { time, period } = timeParts(game);
  const leading = scored && game.home.score !== undefined && game.away.score !== undefined && game.home.score !== game.away.score
    ? (game.home.score > game.away.score ? "home" : "away")
    : null;
  return (
    <article
      className={`card state-${game.state}${covered ? "" : " uncovered"}`}
      style={style}
      data-testid={cardTestId(game)}
    >
      <button
        type="button"
        className="card-main"
        onClick={() => onOpen(game)}
        aria-label={`${game.away.displayName} at ${game.home.displayName}, ${live ? "live, " : ""}${statusLabel(game)}${scored && game.away.score !== undefined ? `, ${game.away.abbr} ${game.away.score}, ${game.home.abbr} ${game.home.score}` : ""}${covered ? `, watch on ${routeLabel(primary, services)}` : ", not on your services"}`}
      >
        <span className="card-head">
          <span className="badge badge-glass league">{LEAGUE_LABEL[game.league]}</span>
          {favorite && (
            <span className="badge badge-glass fav" aria-label="Favorite">
              <Icon name="star" size={14} />
            </span>
          )}
          <span className="head-spacer" />
          {live ? (
            <span className="badge badge-live" data-testid="live-pill">
              <span className="pulse" aria-hidden />
              Live<span className="live-detail">{statusLabel(game)}</span>
            </span>
          ) : (
            <span className="badge badge-glass when">{game.state === "post" ? statusLabel(game) : dayLabel(game)}</span>
          )}
        </span>

        <span className="matchup">
          <Side team={game.away} side="away" score={scored ? game.away.score : null} trailing={leading === "home"} />
          {!scored && (
            <span className="kickoff" aria-hidden>
              <span className="kickoff-time">{time}</span>
              <span className="kickoff-period">{period}</span>
            </span>
          )}
          <Side team={game.home} side="home" score={scored ? game.home.score : null} trailing={leading === "away"} />
        </span>

        <span className="card-foot">
          <span className="foot-info">
            <span className="networks">
              {networks.length ? networks.slice(0, 3).map((n) => <span key={n} className="net">{n}</span>) : <span className="net">TBD</span>}
            </span>
            {covered ? (
              <span className={`route quality-${primary.level}`}>
                {(services[primary.service]?.label ?? primary.service)} · {primary.manual ? "Open it yourself" : primary.installed === false ? "Not on this TV" : primary.local === "guide" ? "In the guide" : primary.local ? "Local channel" : QUALITY_LABEL[primary.level]}{primary.certain ? "" : " · probably"}
              </span>
            ) : (
              <span className="route not-covered">{resolution?.notCovered?.message ?? "Not on your services"}</span>
            )}
          </span>
          {covered ? (
            <span className="cta">
              <Icon name="play" size={16} />
              Watch on TV
            </span>
          ) : (
            <span className="cta cta-muted">Details</span>
          )}
        </span>
      </button>
    </article>
  );
});

export function GameCardSkeleton() {
  return (
    <div className="card card-skeleton" aria-hidden>
      <span className="card-head"><span className="skeleton sk-pill" /><span className="head-spacer" /><span className="skeleton sk-pill" /></span>
      <span className="matchup">
        <span className="side side-away"><span className="skeleton sk-logo" /><span className="skeleton sk-line" /></span>
        <span className="skeleton sk-score" />
        <span className="side side-home"><span className="skeleton sk-logo" /><span className="skeleton sk-line" /></span>
      </span>
      <span className="card-foot"><span className="skeleton sk-line wide" /><span className="skeleton sk-cta" /></span>
    </div>
  );
}
