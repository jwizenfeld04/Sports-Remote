// Roles and what each may do. Keep this the only place that maps roles to abilities.

export type Role = "admin" | "member";
export const ROLES: readonly Role[] = ["admin", "member"];

export type Permission =
  | "view" // see games, TV status
  | "launch" // send a game to the TV
  | "remote" // use the on-screen remote
  | "edit_favorites" // personal preferences: favorite teams, saved views
  | "edit_settings" // household settings: services, priorities
  | "manage_tvs" // add, pair and remove TVs
  | "manage_users" // accounts, sessions of other people
  | "setup"; // change the access mode, re-run setup

const MEMBER: readonly Permission[] = ["view", "launch", "remote", "edit_favorites"];
const ADMIN: readonly Permission[] = [...MEMBER, "edit_settings", "manage_tvs", "manage_users", "setup"];

const GRANTS: Record<Role, ReadonlySet<Permission>> = { admin: new Set(ADMIN), member: new Set(MEMBER) };

/** Can someone with this role do this? Unknown roles can do nothing. */
export function can(role: Role | null | undefined, action: Permission): boolean {
  return !!role && (GRANTS[role]?.has(action) ?? false);
}

export function permissionsFor(role: Role): Permission[] {
  return [...GRANTS[role]];
}
