import type { Game, LaunchLevel, LaunchOutcome, LaunchError, NetworkId, ServiceId } from "./types";
import { NETWORK_LABEL } from "./networks";
import type { AppDef as ServiceDef } from "./catalog/apps";

export interface MessageVars {
  away: string;
  home: string;
  network: string;
  channel: string;
  service: string;
}

export function varsFor(game: Game, network: NetworkId, service: ServiceDef, channelName?: string): MessageVars {
  const net = NETWORK_LABEL[network] ?? network;
  return {
    away: game.away.name,
    home: game.home.name,
    network: net,
    channel: channelName ?? net,
    service: service.label,
  };
}

export function fill(template: string, v: MessageVars): string {
  return template.replace(/\{(away|home|network|channel|service)\}/g, (_, k: keyof MessageVars) => v[k]);
}

const ERROR_TEXT: Record<LaunchError, string> = {
  device_offline: "the TV isn't connected",
  no_tv: "no TV is set up yet. An admin can add one in Settings → Services, TVs and your area",
  not_installed: "that app isn't available on this TV",
  busy: "another launch is still running",
  bad_params: "the launch request was invalid",
  unknown_service: "that service isn't set up",
  adb_error: "the TV rejected the command",
  plex_error: "Plex couldn't tune the channel",
  timeout: "the TV didn't respond in time",
  not_covered: "this game isn't on your services",
  unknown_game: "that game isn't in today's list",
};

export interface RenderedMessage {
  title: string;
  message: string;
  persistent: boolean;
}

/**
 * One message per launch outcome. `unverifiedRoute` means a deep link that Phase 0 hasn't confirmed
 * yet reported success: we say what we tried and still show the app-only path in case it fell short.
 */
export function renderOutcome(
  outcome: LaunchOutcome,
  service: ServiceDef | null,
  v: MessageVars | null,
  opts: { level?: LaunchLevel | null; error?: LaunchError; unverifiedRoute?: boolean } = {},
): RenderedMessage {
  const appPath = service && v ? fill(service.appOnlyMessage, v) : "";
  switch (outcome) {
    case "game":
      return opts.unverifiedRoute
        ? { title: `Opened ${v!.away} at ${v!.home} in ${v!.service}`, message: `If it didn't land on the game: ${appPath}`, persistent: true }
        : { title: `On TV: ${v!.away} at ${v!.home}`, message: `Playing in ${v!.service}.`, persistent: false };
    case "channel":
      return opts.unverifiedRoute
        ? { title: `Opened ${v!.channel} in ${v!.service}`, message: `If it isn't on the right channel: ${appPath}`, persistent: true }
        : { title: `On TV: ${v!.channel} in ${v!.service}`, message: `${v!.away} at ${v!.home} should be on now.`, persistent: false };
    case "app":
      return { title: `Opened ${v!.service}`, message: `${appPath} Use the remote below to finish.`, persistent: true };
    case "manual":
      return { title: `Open ${v!.service} on the TV`, message: `${appPath} Sports Remote can't open this app for you yet; use the remote below.`, persistent: true };
    case "profile_picker":
      return { title: `${v!.service} is asking who's watching`, message: "Pick a profile with the remote below.", persistent: true };
    case "unverified":
      return { title: "Sent to TV", message: `Couldn't confirm ${v?.service ?? "the app"} opened. Check the TV, or retry.`, persistent: true };
    case "failed":
      return { title: "Couldn't reach the TV", message: `Not sent: ${ERROR_TEXT[opts.error ?? "adb_error"]}.`, persistent: true };
  }
}

export function serviceLabel(id: ServiceId, apps: ReadonlyMap<string, ServiceDef>): string {
  return apps.get(id)?.label ?? id;
}

/** Strip the light **bold** markup for plain-text contexts (logs, aria). */
export const plain = (s: string) => s.replace(/\*\*/g, "");
