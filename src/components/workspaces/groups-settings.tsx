"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import type { GroupAdminView, TeamWorkspaceView } from "@/server/workspace-admin";
import {
  GovernanceError,
  governanceFailure,
  governanceRequest,
  type GovernanceFailure,
} from "./governance-error";
import { GrantRowActions } from "./grant-row-actions";
export function GroupsSettings({
  team,
  groups,
}: {
  team: TeamWorkspaceView;
  groups: readonly GroupAdminView[];
}) {
  const router = useRouter();
  const toast = useToast();
  const { access, confirmed } = useWorkspaceAuthorization();
  const [externalGroupId, setExternalGroupId] = useState("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GovernanceFailure | null>(null);
  const roles = team.grantOptions.newGroupAssignableRoles;
  const chosenRole = roles.find((value) => value === role) ?? roles[0] ?? "";
  const canAdd =
    access.actions.canManageBasicGroups &&
    access.workspace.lifecycleState === "ACTIVE" &&
    roles.length > 0;
  const groupsUrl = `/api/workspaces/${team.id}/groups`;
  async function grantGroup(id: string, assigned: string) {
    await governanceRequest(groupsUrl, "POST", { externalGroupId: id, role: assigned });
    router.refresh();
  }
  async function setGroupRole(id: string, assigned: string) {
    await governanceRequest(groupsUrl, "PATCH", { externalGroupId: id, role: assigned });
    router.refresh();
  }
  async function removeGroup(id: string) {
    await governanceRequest(groupsUrl, "DELETE", { externalGroupId: id });
    router.refresh();
  }
  return (
    <section className="space-y-6">
      <h2 className="text-title font-semibold">SSO Groups</h2>
      <p className="text-body text-kh-text-muted">
        Map canonical group IDs supplied by your company SSO. Group membership is evaluated from the
        signed-in user’s trusted session.
      </p>
      {canAdd && (
        <details className="max-w-panel border-b border-kh-border pb-3"><summary className="kh-focus-ring w-fit cursor-pointer rounded-md text-body font-medium">Add group mapping</summary>
        <form
          className="mt-3 space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!confirmed || busy || !externalGroupId.trim() || !chosenRole) return;
            const id = externalGroupId.trim();
            const assigned = chosenRole;
            setBusy(true);
            setError(null);
            try {
              await grantGroup(id, assigned);
              setExternalGroupId("");
              toast({
                message: `${id} mapped to ${assigned}.`,
                undo: { run: () => removeGroup(id) },
              });
            } catch (failure) {
              setError(governanceFailure(failure));
            } finally {
              setBusy(false);
            }
          }}
        >

          <label className="block text-body">
            External group ID
            <Input
              value={externalGroupId}
              required
              disabled={busy || !confirmed}
              onChange={(event) => setExternalGroupId(event.target.value)}
            />
          </label>
          <label className="block text-body">
            Role
            <Select
              className="ml-3"
              aria-label="New group role"
              value={chosenRole}
              disabled={busy || !confirmed}
              onChange={(event) => setRole(event.target.value)}
            >
              {roles.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </Select>
          </label>
          <Button type="submit" disabled={busy || !confirmed || !externalGroupId.trim()}>
            Add group mapping
          </Button>
        </form>
        </details>
      )}
      <GovernanceError error={error} />
      {groups.length === 0 ? (
        <p className="text-body">No SSO group mappings yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-body">
            <thead className="hidden sm:table-header-group">
              <tr>
                {["External group ID", "Role", "Actions"].map((label) => (
                  <th className="border-b border-kh-border px-3 py-2 text-caption font-medium text-kh-text-muted" key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="block sm:table-row-group">
              {groups.map((group) => (
                <tr className="grid grid-cols-2 gap-x-3 border-b border-kh-border py-2 sm:table-row sm:py-0" key={group.externalGroupId}>
                  <td className="block px-3 py-2 align-top break-all sm:table-cell">{group.externalGroupId}</td>
                  <td className="block px-3 py-2 align-top sm:table-cell"><span className="block text-caption text-kh-text-muted sm:hidden">Role</span>{group.role}</td>
                  <td className="col-span-2 block px-3 py-2 align-top sm:table-cell">
                    <GrantRowActions
                      role={group.role}
                      roles={group.assignableRoles}
                      canRemove={group.canRemove}
                      label={group.externalGroupId}
                      onChangeRole={(assigned) => setGroupRole(group.externalGroupId, assigned)}
                      onRemove={() => removeGroup(group.externalGroupId)}
                      onRestore={(assigned) => grantGroup(group.externalGroupId, assigned)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
