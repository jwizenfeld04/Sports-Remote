import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { Game, LaunchRoute, Resolution, ServiceId } from "../../lib/types";
import type { AppDef as ServiceDef } from "../../lib/catalog/apps";
import { NETWORK_LABEL, OUTLET_LABEL } from "../../lib/networks";
import { SUBSCRIPTION_BY_ID } from "../../lib/catalog/subscriptions";
import { teamKey } from "../../lib/teams";
import { LEAGUE_LABEL, QUALITY_LABEL, statusLabel } from "../format";
import { cardColors } from "../teamColors";
import { Button, Icon, IconButton, PopUpButton, Sheet, TeamLogo } from "./ui";

interface Props {
  game: Game;
  resolution: Resolution;
  services: Record<string, ServiceDef>;
  favorites: string[];
  sending: boolean;
  onSend: (route: LaunchRoute) => void;
  onToggleFavorite: (key: string) => void;
  onClose: () => void;
}

export function LaunchSheet({ game, resolution, services, favorites, sending, onSend, onToggleFavorite, onClose }: Props) {
  const [idx, setIdx] = useState(0);
  const route = resolution.routes[idx];
  const c = useMemo(() => cardColors(game.away, game.home), [game.away, game.home]);
  const style = { "--away": c.away, "--away-ink": c.awayInk, "--home": c.home, "--home-ink": c.homeInk } as CSSProperties;
  const scored = game.state !== "pre";

  useEffect(() => {
    setIdx(0);
  }, [game.id]);

  return (
    <Sheet labelledBy="sheet-title" onClose={onClose} testId="launch-sheet">
      <header className="sheet-hero" style={style}>
        <div className="hero-top">
          <p className="eyebrow">
            {game.state === "in" && <span className="pulse" aria-hidden />}
            {LEAGUE_LABEL[game.league]} · {statusLabel(game)}
          </p>
          <IconButton icon="close" label="Close" className="on-color" onClick={onClose} />
        </div>
        <div className="hero-matchup" aria-hidden>
          <span className="hero-side side-away">
            <TeamLogo logo={game.away.logo} abbr={game.away.abbr} size={52} />
            {scored && <span className="hero-score">{game.away.score ?? "–"}</span>}
          </span>
          <span className="hero-side side-home">
            {scored && <span className="hero-score">{game.home.score ?? "–"}</span>}
            <TeamLogo logo={game.home.logo} abbr={game.home.abbr} size={52} />
          </span>
        </div>
        <h2 id="sheet-title" className="sheet-title">{game.away.displayName} at {game.home.displayName}</h2>
      </header>

      <div className="sheet-body">
        <div className="fav-toggles" role="group" aria-label="Favorite teams">
          {[game.away, game.home].map((t) => {
            const key = teamKey(game.league, t);
            const on = favorites.includes(key);
            return (
              <button key={key} type="button" className={`chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => onToggleFavorite(key)}>
                <Icon name={on ? "star" : "star-off"} size={16} /> {t.name}
              </button>
            );
          })}
        </div>

        {route ? (
          <>
            <div className="field-group">
              <span className="field-label" id="watch-on-label">Watch on</span>
              <PopUpButton
                variant="field"
                label="Watch on"
                value={idx}
                options={resolution.routes.map((r, i) => ({ value: i, label: (services[r.service]?.label ?? r.service), detail: `${r.outlet ? OUTLET_LABEL[r.outlet] : NETWORK_LABEL[r.network]} · ${r.manual ? "open it yourself" : r.installed === false ? "not on this TV" : QUALITY_LABEL[r.level]}${r.certain ? "" : " · probably"}` }))}
                onChange={setIdx}
                testId="service-select"
              />
            </div>
            <p className="route-reason" data-testid="launch-route-reason">
              {(services[route.service]?.label ?? route.service)}: {route.reason}. <span className={`quality quality-${route.level}`}>{QUALITY_LABEL[route.level]}{route.levelVerified === false ? " (untested here)" : ""}</span>
            </p>
            {!route.certain && <p className="route-reason small">Probably: {route.network === "nfl_sunday_ticket" || route.reason.startsWith("If your local") ? "it depends on which game your local station picked." : "this channel isn't confirmed in that plan's lineup."}</p>}
            {route.manual && <p className="route-reason small">Sports Remote can't open this app by itself: Send wakes the TV and shows the steps.</p>}
            {route.installed === false && <p className="route-reason not-covered small">The {(services[route.service]?.label ?? route.service)} app isn't on this TV. Install it from the TV's app store.</p>}
            <Button variant="primary" block icon="tv" data-autofocus data-testid="send-to-tv" disabled={sending} onClick={() => onSend(route)}>
              {sending ? "Sending..." : "Send to TV"}
            </Button>
          </>
        ) : (
          <div className="route-reason not-covered" data-testid="launch-route-reason">
            <p>{resolution.notCovered?.message}</p>
            {!!resolution.notCovered?.suggestions.length && (
              <p className="small">Would be on: {resolution.notCovered.suggestions.slice(0, 4).map((s) => SUBSCRIPTION_BY_ID.get(s.id)?.name ?? s.id).join(", ")}.</p>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
