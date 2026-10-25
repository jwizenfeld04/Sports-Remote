import type { SimTv } from "./tv";

/** A readable log of what happened on the TV, for debugging a failing seed. */
export function trace(tv: SimTv, o: { reads?: boolean } = {}): string {
  return tv.events
    .filter((e) => o.reads || e.type !== "read")
    .map((e) => {
      const t = `${(e.t / 1000).toFixed(1).padStart(6)}s`;
      switch (e.type) {
        case "key": return `${t} key ${e.key}${e.delivered ? "" : " (dropped)"} on ${e.pkg}:${e.screen}${e.popup ? " [popup]" : ""}`;
        case "intent": return `${t} intent ${e.uri} ${e.warm ? "warm" : "cold"}${e.handled ? "" : " (ignored)"}`;
        case "screen": return `${t} ${e.pkg}: ${e.from || "-"} -> ${e.to}`;
        case "popup": return `${t} popup ${e.shown ? "shown" : "closed"}: ${e.text}`;
        case "mark": return `${t} mark ${e.kind} ${JSON.stringify(e.data ?? "")}`;
        case "read": return `${t} read ${e.pkg}:${e.screen}${e.black ? " black" : ""}${e.error ? " error" : ""}: ${e.text.slice(0, 160)}`;
        default: return `${t} ${e.type} ${e.pkg}`;
      }
    })
    .join("\n");
}
