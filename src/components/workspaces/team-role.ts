/**
 * The two roles a team's UI offers, and the two it only reads back.
 *
 * The domain keeps four roles and their capability bundles unchanged. The UI
 * offers 管理員 (`ADMIN`) and 成員 (`EDITOR`); `OWNER` belongs to the team's
 * creator and `VIEWER` is hidden. An existing `OWNER`/`VIEWER` is displayed
 * as it is and cannot be chosen or silently rewritten.
 */
export type TeamRole = "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";

export const SELECTABLE_TEAM_ROLES: readonly TeamRole[] = ["ADMIN", "EDITOR"];

const ROLE_LABELS: Record<TeamRole, string> = {
  OWNER: "擁有者",
  ADMIN: "管理員",
  EDITOR: "成員",
  VIEWER: "檢視者",
};

export function teamRoleLabel(role: string): string {
  const known = ROLE_LABELS[role as TeamRole];
  return known ? `${known}（${role}）` : role;
}

/** The server's assignable set, narrowed to what the UI may offer. */
export function assignableTeamRoles(roles: readonly string[]): string[] {
  return roles.filter((role) => SELECTABLE_TEAM_ROLES.includes(role as TeamRole));
}

/**
 * The options a role selector draws: only 管理員 and 成員, plus the role held
 * now when it is one the UI does not offer — displayed, disabled, never
 * rewritten by being absent from the list.
 */
export function teamRoleOptions(
  roles: readonly string[],
  currentRole: string,
): Array<{ value: string; label: string; disabled?: boolean }> {
  const selectable = assignableTeamRoles(roles);
  return [
    ...(selectable.includes(currentRole)
      ? []
      : [{ value: currentRole, label: teamRoleLabel(currentRole), disabled: true }]),
    ...selectable.map((value) => ({ value, label: teamRoleLabel(value) })),
  ];
}
