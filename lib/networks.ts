// Compatibility layer: the network catalog lives in lib/catalog/networks.ts.
import { classifyLabel, NETWORK_LABEL, normalizeLabel, type NetworkId } from "./catalog/networks";

export { NETWORK_LABEL, NETWORK_IDS, NETWORK_KIND, OUTLET_LABEL, classifyLabel, normalizeLabel } from "./catalog/networks";

export function isRegionalLabel(raw: string): boolean {
  return classifyLabel(raw).network === "local";
}

export function networkFromLabel(raw: string): { network: NetworkId; regional: boolean } {
  const c = classifyLabel(raw);
  return { network: c.network, regional: c.network === "local" };
}

// The broadcast networks whose local stations an antenna or live TV service carries.
export const LOCAL_NETWORKS: NetworkId[] = ["abc", "cbs", "fox", "nbc"];
export const networkLabel = (n: NetworkId) => NETWORK_LABEL[n] ?? normalizeLabel(n);
