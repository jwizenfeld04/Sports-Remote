import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AllowedKey, Game, LaunchResult, LaunchRoute, LocalGuide, NetworkId, Resolution, ServiceId, Settings, TvStatus } from "../lib/types";
import { resolveGame, type ResolveContext } from "../lib/resolve";
import { APP_RECORD } from "./catalog";
// Setup and coverage load on demand: most visits are the game list and the remote.
const Setup = lazy(() => import("./setup/Setup").then((m) => ({ default: m.Setup })));
const CoveragePage = lazy(() => import("./setup/CoveragePage").then((m) => ({ default: m.CoveragePage })));
import { applyFilters, blockingFilter, DEFAULT_FILTERS, isFavorite, sections, type FilterState } from "../lib/filters";
import { buildIndex } from "../lib/search";
import { parseFilters, serializeFilters } from "../lib/urlState";
import { api, loadBoot, newRequestId, reportClientError, type Boot, type HouseholdView, type TvView } from "./api";
import { GameCard, GameCardSkeleton } from "./components/GameCard";
import { LaunchSheet } from "./components/LaunchSheet";
import { ResultPanel } from "./components/ResultPanel";
import { RemoteSheet } from "./components/RemoteSheet";
import { KeyToast, keyFailure, type KeyNotice } from "./components/KeyToast";
import { FilterPanel, FilterTokens, filterTokens, LeagueControl, ViewControl } from "./components/FilterBar";
import { SettingsSheet } from "./components/SettingsSheet";
import { Login } from "./components/Login";
import { Button, Icon, IconButton, Popover, SearchField } from "./components/ui";

const FILTER_NAMES: Partial<Record<keyof FilterState, string>> = {
  q: "search", favorites: "Favorites", myServices: "On my services", service: "Watch on", quality: "Opens game or channel",
  close: "Close games", networks: "Network", leagues: "League", status: "Status", time: "When",
};

function TvDot({ tv }: { tv: TvStatus | null }) {
  const state = !tv ? "unknown" : tv.adb === "connected" ? (tv.screenOn === false ? "sleep" : "ok") : tv.adb;
  const label = {
    unknown: "TV status unknown", ok: "TV connected", sleep: "TV connected (screen off)", offline: "TV offline", unauthorized: "Approve this server on the TV",
  }[state];
  return (
    <span className={`tv-dot tv-${state}`} role="status" aria-label={label} title={label} data-testid="tv-status">
      <Icon name="tv" size={18} />
      <span className="dot" aria-hidden />
    </span>
  );
}

export function App({ initial }: { initial?: Boot }) {
  const [boot, setBoot] = useState<Boot | null>(initial ?? null);
  const [games, setGames] = useState<Game[]>(initial?.games ?? []);
  const [stale, setStale] = useState(!!initial?.stale);
  const [feedError, setFeedError] = useState<string | null>(initial?.feedError ?? null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(initial?.fetchedAt ?? null);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine !== false);
  const [liveDown, setLiveDown] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [guide, setGuide] = useState<LocalGuide | null>(initial?.guide ?? null);
  const [settings, setSettings] = useState<Settings | null>(initial?.settings ?? null);
  const services = APP_RECORD;
  const [household, setHousehold] = useState<HouseholdView | null>(initial?.household ?? null);
  const [tvList, setTvList] = useState<TvView[]>(initial?.tvs ?? []);
  const [tvId, setTvIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem("sr-tv");
    } catch {
      return null;
    }
  });
  const setTvId = useCallback((id: string) => {
    setTvIdState(id);
    try {
      localStorage.setItem("sr-tv", id);
    } catch {
      /* private mode: just this page */
    }
  }, []);
  const [page, setPage] = useState<"games" | "setup" | "coverage">(() =>
    typeof location !== "undefined" && location.pathname === "/setup" ? "setup" : typeof location !== "undefined" && location.pathname === "/coverage" ? "coverage" : "games");
  const go = useCallback((p: "games" | "setup" | "coverage") => {
    setPage(p);
    history.pushState(null, "", p === "games" ? "/" + location.search : `/${p}`);
  }, []);
  const [filters, setFiltersState] = useState<FilterState>(() => (typeof location !== "undefined" ? parseFilters(location.search) : DEFAULT_FILTERS));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [open, setOpen] = useState<Game | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<string | null>(null); // the current step of a slow launch
  const launchId = useRef<string | null>(null);
  const [result, setResult] = useState<LaunchResult | null>(null);
  const lastLaunch = useRef<{ game: Game; route: LaunchRoute } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const filtersBtn = useRef<HTMLButtonElement>(null);

  const applyBoot = useCallback((b: Boot) => {
    setBoot(b);
    if (!b.authed) return;
    setGames(b.games ?? []);
    setStale(!!b.stale);
    setFeedError(b.feedError ?? null);
    setFetchedAt(b.fetchedAt ?? null);
    setGuide(b.guide ?? null);
    if (b.settings) setSettings(b.settings);
    if (b.household) setHousehold(b.household);
    setTvList(b.tvs ?? []);
  }, []);

  useEffect(() => {
    if (!initial) loadBoot().then(applyBoot).catch(() => setBoot({ authed: false }));
  }, [initial, applyBoot]);

  // Live updates over SSE.
  useEffect(() => {
    if (!boot?.authed || typeof EventSource === "undefined") return;
    const es = new EventSource("/api/events");
    let dropped = false;
    es.onerror = () => {
      dropped = true;
      setLiveDown(true);
    };
    es.onopen = () => {
      setLiveDown(false);
      // Changes while disconnected weren't pushed: catch up.
      if (dropped) api.bootstrap().then(applyBoot).catch(() => {});
      dropped = false;
    };
    es.addEventListener("games", (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setGames(d.games ?? []);
      setStale(!!d.stale);
      setFeedError(d.feedError ?? null);
      setFetchedAt(d.fetchedAt ?? null);
    });
    es.addEventListener("guide", (e) => setGuide(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("tv", (e) => {
      const t = JSON.parse((e as MessageEvent).data) as TvView;
      setTvList((list) => (list.some((x) => x.id === t.id) ? list.map((x) => (x.id === t.id ? t : x)) : [...list, t]));
    });
    es.addEventListener("household", (e) => setHousehold(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("settings", (e) => setSettings(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("launch_progress", (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      if (d.requestId === launchId.current && typeof d.message === "string") setProgress(d.message);
    });
    return () => es.close();
  }, [boot?.authed, applyBoot]);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  const refresh = useCallback(async () => {
    setRetrying(true);
    try {
      applyBoot(await api.bootstrap());
    } catch {
      /* the offline/feed banners already explain it */
    } finally {
      setRetrying(false);
    }
  }, [applyBoot]);

  // Filters <-> URL (bookmarkable; back/forward work).
  const setFilters = useCallback((f: FilterState) => {
    setFiltersState(f);
    const qs = serializeFilters(f);
    history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
  }, []);
  useEffect(() => {
    const onPop = () => {
      setFiltersState(parseFilters(location.search));
      setPage(location.pathname === "/setup" ? "setup" : location.pathname === "/coverage" ? "coverage" : "games");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // "/" focuses search, Escape clears it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const s = settings;
  // The TV this device controls: its choice, else the household default, else the first.
  const tv: TvView | null = tvList.find((t) => t.id === tvId) ?? tvList.find((t) => t.id === s?.defaultTv) ?? tvList[0] ?? null;
  const rctx: ResolveContext | null = useMemo(() => (s && household ? {
    household: { market: household.market, subscriptions: household.subscriptions, tveSignIns: household.tveSignIns, servicePriority: s.servicePriority },
    platform: tv?.platform ?? "firetv",
    installedApps: tv?.apps ? new Set(tv.apps) : null,
    guide,
    experimental: s.experimentalLaunches && boot?.capabilities?.ocr !== false,
  } : null), [s, household, tv?.platform, tv?.apps, guide, boot?.capabilities?.ocr]);
  const tvRef = useRef<string | null>(null);
  tvRef.current = tv?.id ?? null;
  const resolutions = useMemo(() => {
    const m = new Map<string, Resolution>();
    if (!rctx) return m;
    for (const g of games) m.set(g.id, resolveGame(g, rctx));
    return m;
  }, [games, rctx]);
  const index = useMemo(() => buildIndex(games), [games]);
  const deferred = useDeferredValue(filters);
  const now = new Date();
  const ctx = s ? { settings: s, resolutions, now, index, timezone: household?.market.timezone } : null;
  const visible = useMemo(() => (ctx ? applyFilters(games, deferred, ctx) : []), [games, deferred, resolutions, s, index]); // eslint-disable-line react-hooks/exhaustive-deps
  const networks = useMemo(() => {
    const set = new Set<NetworkId>();
    for (const g of games) for (const b of g.broadcasts) if (b.network !== "unknown" && b.network !== "local") set.add(b.network);
    return [...set].sort();
  }, [games]);

  const send = useCallback(async (game: Game, route: LaunchRoute) => {
    lastLaunch.current = { game, route };
    setOpen(null);
    setResult(null);
    setPending(true);
    setProgress(null);
    const requestId = newRequestId();
    launchId.current = requestId;
    try {
      const r = await api.launch({ requestId, gameId: game.id, tv: tvRef.current ?? undefined, route: { service: route.service, network: route.network } });
      setResult(r.data);
    } catch (e) {
      reportClientError("api", `launch request failed: ${(e as Error).message}`, { where: game.id });
      setResult({
        requestId: "", ok: false, level: null, verified: false, outcome: "failed", title: "Couldn't reach the TV",
        message: "Not sent: the server didn't answer.", persistent: true, attempts: [], error: "timeout",
      });
    } finally {
      setPending(false);
      setProgress(null);
      launchId.current = null;
    }
  }, []);

  const onOpen = useCallback(
    (g: Game) => {
      const res = resolutions.get(g.id);
      if (s?.oneTapSend && res?.routes[0]) void send(g, res.routes[0]);
      else setOpen(g);
    },
    [resolutions, s, send],
  );

  const saveSettings = useCallback(async (next: Settings) => {
    setSettings(next);
    const r = await api.saveSettings(next);
    if (r.status === 200) setSettings(r.data);
  }, []);

  const toggleFavorite = useCallback(
    (key: string) => {
      if (!s) return;
      const favs = s.favorites.includes(key) ? s.favorites.filter((f) => f !== key) : [...s.favorites, key];
      void saveSettings({ ...s, favorites: favs });
    },
    [s, saveSettings],
  );

  const [keyNotice, setKeyNotice] = useState<KeyNotice | null>(null);
  const keyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onKey = useCallback((k: AllowedKey) => {
    const loud = k === "SLEEP"; // d-pad taps stay quiet unless they fail
    clearTimeout(keyTimer.current);
    if (loud) setKeyNotice({ state: "pending", text: "Turning TV off..." });
    api.key(k, tvRef.current ?? undefined).then(
      (r) => {
        if (r.status === 200 && r.data?.ok) {
          setKeyNotice(loud ? { state: "ok", text: "TV is off" } : null);
        } else {
          setKeyNotice({ state: "failed", text: keyFailure(r.status, (r.data as { error?: string } | null)?.error) });
        }
        keyTimer.current = setTimeout(() => setKeyNotice(null), r.status === 200 ? 2500 : 5000);
      },
      () => {
        setKeyNotice({ state: "failed", text: "Couldn't reach the server" });
        keyTimer.current = setTimeout(() => setKeyNotice(null), 5000);
      },
    );
  }, []);
  const dismiss = useCallback(() => setResult(null), []);
  const retry = useCallback(() => {
    if (lastLaunch.current) void send(lastLaunch.current.game, lastLaunch.current.route);
  }, [send]);

  if (!boot) return <LoadingShell label="Loading games..." />;
  const isAdmin = boot.me?.role === "admin";
  // First run: the setup page creates the first admin with the one-time link from the server log.
  if (!boot.authed && (page === "setup" || boot.auth?.setupRequired)) return lazyPage(<Setup boot={boot} onBoot={applyBoot} games={games} />);
  if (!boot.authed) return <Login auth={boot.auth} onDone={() => api.bootstrap().then(applyBoot)} />;
  if (!s || !household) return <LoadingShell label="Loading settings..." />;
  if (isAdmin && (page === "setup" || !household.setupComplete)) {
    return lazyPage(<Setup boot={boot} onBoot={applyBoot} games={games} onDone={() => go("coverage")} />);
  }
  if (page === "coverage") return lazyPage(<CoveragePage household={household} settings={s} games={games} tv={tv} isAdmin={isAdmin} onEdit={() => go("setup")} onBack={() => go("games")} />);

  const { live, upcoming, final: finals } = sections(visible, s);
  const blocking = visible.length === 0 && ctx ? blockingFilter(games, filters, ctx) : null;
  const nFilters = filterTokens(filters, services).length;
  const card = (g: Game) => (
    <GameCard key={g.id} game={g} resolution={resolutions.get(g.id)} services={services} favorite={isFavorite(g, s)} onOpen={onOpen} />
  );
  // Why the list might be empty, most fundamental first.
  const feed: "ok" | "loading" | "error" | "empty" =
    games.length > 0 ? "ok" : fetchedAt === null ? "loading" : stale || feedError ? "error" : "empty";

  return (
    <div className="app">
      <header className="topbar">
        <div className="toolbar">
          <div className="brand">
            <img className="brand-mark" src="/icon.svg" alt="" width={28} height={28} />
            <h1 className="brand-name">Sports Remote</h1>
          </div>
          <div className="toolbar-segments">
            <LeagueControl filters={filters} onChange={setFilters} />
            <ViewControl filters={filters} onChange={setFilters} />
          </div>
          <SearchField
            ref={searchRef}
            placeholder="Search"
            aria-label="Search games"
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            onKeyDown={(e) => e.key === "Escape" && setFilters({ ...filters, q: "" })}
            onClear={() => {
              setFilters({ ...filters, q: "" });
              searchRef.current?.focus();
            }}
            data-testid="search-input"
          />
          <div className="topbar-actions">
            <button
              ref={filtersBtn}
              type="button"
              className={`tool-btn filters-toggle${nFilters ? " has-filters" : ""}${filtersOpen ? " open" : ""}`}
              aria-expanded={filtersOpen}
              aria-haspopup="dialog"
              aria-controls={filtersOpen ? "filter-popover" : undefined}
              aria-label={`Filters${nFilters ? ` (${nFilters} on)` : ""}`}
              onClick={() => setFiltersOpen(!filtersOpen)}
              data-testid="filters-toggle"
            >
              <Icon name="sliders" size={18} />
              <span className="tool-btn-label">Filters</span>
              {nFilters > 0 && <span className="dot-count" aria-hidden>{nFilters}</span>}
            </button>
            {tvList.length > 1 && (
              <select className="tv-select" aria-label="TV" value={tv?.id ?? ""} onChange={(e) => setTvId(e.target.value)} data-testid="tv-select">
                {tvList.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
            <TvDot tv={tv} />
            <IconButton icon="chart" label="Coverage" onClick={() => go("coverage")} data-testid="coverage-open" />
            <IconButton icon="remote" label="TV remote" onClick={() => setRemoteOpen(true)} data-testid="remote-open" />
            <IconButton icon="gear" label="Settings" onClick={() => setSettingsOpen(true)} data-testid="settings-open" />
          </div>
        </div>
        <FilterTokens filters={filters} services={services} onChange={setFilters} />
      </header>
      {filtersOpen && (
        <Popover anchor={filtersBtn} onClose={() => setFiltersOpen(false)} label="Filters" id="filter-popover" width={640} testId="filter-popover">
          <FilterPanel
            filters={filters}
            onChange={setFilters}
            networks={networks}
            services={services}
            presets={s.presets}
            onApplyPreset={(q) => setFilters({ ...parseFilters(q), q: filters.q })}
            onSavePreset={() => {
              const name = prompt("Name this view");
              const query = serializeFilters({ ...filters, q: "" });
              if (name) void saveSettings({ ...s, presets: [...s.presets.filter((p) => p.name !== name), { name: name.slice(0, 40), query }] });
            }}
          />
        </Popover>
      )}

      <main className="content" aria-busy={feed === "loading"}>
        {!online && (
          <p className="banner banner-warn" role="status" data-testid="offline-banner">
            <Icon name="offline" size={18} /> You're offline. Showing the last scores this device saw.
          </p>
        )}
        {online && liveDown && (
          <p className="banner" role="status" data-testid="reconnecting-banner">
            <span className="spinner" aria-hidden /> Reconnecting to the server for live scores...
          </p>
        )}
        {stale && feed === "ok" && (
          <p className="banner banner-warn" role="status" data-testid="stale-banner">
            <Icon name="alert" size={18} /> Scores may be out of date: ESPN didn't answer on the last refresh.
          </p>
        )}

        {feed === "loading" && (
          <section className="section" aria-label="Loading games">
            <p className="sr-only" role="status">Loading games...</p>
            <div className="grid">{Array.from({ length: 6 }, (_, i) => <GameCardSkeleton key={i} />)}</div>
          </section>
        )}

        {feed === "error" && (
          <div className="state-card error" role="alert" data-testid="feed-error">
            <span className="state-icon"><Icon name="alert" size={28} /></span>
            <h2>Can't load games from ESPN</h2>
            <p>The server couldn't get the NFL, MLB and NHL scoreboards, so there's nothing to show yet. It keeps retrying on its own.</p>
            {feedError && <p className="state-detail">Last error: <code>{feedError}</code></p>}
            <Button variant="primary" icon="refresh" onClick={() => void refresh()} disabled={retrying}>{retrying ? "Checking..." : "Try again"}</Button>
          </div>
        )}

        {feed === "empty" && (
          <div className="state-card" role="status" data-testid="feed-empty">
            <span className="state-icon"><Icon name="tv" size={28} /></span>
            <h2>No games scheduled</h2>
            <p>ESPN lists no NFL, MLB or NHL games from yesterday through the next 7 days.</p>
            <Button icon="refresh" onClick={() => void refresh()} disabled={retrying}>Refresh</Button>
          </div>
        )}

        {feed === "ok" && (
          <>
            {visible.length === 0 ? (
              <div className="state-card" data-testid="empty-state">
                <span className="state-icon"><Icon name="search" size={28} /></span>
                <h2>No games match</h2>
                <p>{games.length} game{games.length === 1 ? " is" : "s are"} hidden by your search or filters.</p>
                <div className="state-actions">
                  {blocking && (
                    <Button variant="primary" onClick={() => setFilters({ ...filters, [blocking]: DEFAULT_FILTERS[blocking] })}>
                      Clear {FILTER_NAMES[blocking] ?? blocking}
                    </Button>
                  )}
                  <Button onClick={() => setFilters(DEFAULT_FILTERS)}>Show all games</Button>
                </div>
              </div>
            ) : (
              <>
                {live.length > 0 && <Section title="Live" games={live} render={card} />}
                {upcoming.length > 0 && <Section title="Upcoming" games={upcoming} render={card} />}
                {finals.length > 0 && <Section title="Final" games={finals} render={card} />}
              </>
            )}
          </>
        )}
      </main>

      {open && resolutions.get(open.id) && (
        <LaunchSheet
          game={open}
          resolution={resolutions.get(open.id)!}
          services={services}
          favorites={s.favorites}
          sending={pending}
          onSend={(r) => void send(open, r)}
          onToggleFavorite={toggleFavorite}
          onClose={() => setOpen(null)}
        />
      )}
      {remoteOpen && <RemoteSheet onKey={onKey} onClose={() => setRemoteOpen(false)} />}
      {settingsOpen && (
        <SettingsSheet
          ocrMissing={boot.capabilities?.ocr === false}
          settings={s}
          household={household}
          isAdmin={isAdmin}
          onSetup={() => {
            setSettingsOpen(false);
            go("setup");
          }}
          onSave={(n) => {
            void saveSettings(n);
            setSettingsOpen(false);
          }}
          onLogout={() => api.logout().then(() => api.bootstrap()).then(applyBoot, () => setBoot({ authed: false }))}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {keyNotice && !pending && !result && <KeyToast notice={keyNotice} />}
      <ResultPanel pending={pending} progress={progress} result={result} onKey={onKey} onRetry={retry} onDismiss={dismiss} />
    </div>
  );
}

function LoadingShell({ label }: { label: string }) {
  return (
    <div className="app">
      <header className="topbar">
        <div className="toolbar">
          <div className="brand"><img className="brand-mark" src="/icon.svg" alt="" width={28} height={28} /><span className="brand-name">Sports Remote</span></div>
          <span className="skeleton sk-search" />
        </div>
      </header>
      <main className="content loading" aria-busy="true">
        <p className="sr-only" role="status">{label}</p>
        <div className="grid">{Array.from({ length: 6 }, (_, i) => <GameCardSkeleton key={i} />)}</div>
      </main>
    </div>
  );
}

function Section({ title, games, render }: { title: string; games: Game[]; render: (g: Game) => React.ReactNode }) {
  const id = `sec-${title.toLowerCase()}`;
  return (
    <section aria-labelledby={id} className="section">
      <h2 id={id} className={`section-title${title === "Live" ? " is-live" : ""}`}>
        {title === "Live" && <span className="pulse" aria-hidden />}
        {title} <span className="count">{games.length}</span>
      </h2>
      <div className="grid">{games.map((g) => render(g))}</div>
    </section>
  );
}


function lazyPage(el: ReactNode) {
  return <Suspense fallback={<div className="app page-loading" role="status"><span className="spinner" aria-hidden /> Loading...</div>}>{el}</Suspense>;
}
