import { APPS, type AppDef } from "../lib/catalog/apps";
import { SUBSCRIPTION_BY_ID } from "../lib/catalog/subscriptions";
import type { LaunchRoute } from "../lib/types";

/** Catalog apps by id, for labels in the UI. */
export const APP_RECORD: Record<string, AppDef> = Object.fromEntries(APPS.map((a) => [a.id, a]));
export type Apps = Record<string, AppDef>;

/** "YouTube TV (NFL Sunday Ticket)" when the subscription isn't the app itself; otherwise just the app. */
export function routeLabel(r: Pick<LaunchRoute, "service" | "subscription">, apps: Apps = APP_RECORD): string {
  const app = apps[r.service]?.label ?? r.service;
  const sub = r.subscription ? SUBSCRIPTION_BY_ID.get(r.subscription)?.name : undefined;
  return sub && !sub.startsWith(app) && !app.startsWith(sub) && r.subscription !== "antenna" ? `${app} (${sub})` : app;
}
