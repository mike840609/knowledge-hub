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
        <form
          className="max-w-panel space-y-3 rounded-md border border-kh-border p-4"
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
          <h3 className="font-medium">Add group mapping</h3>
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
      )}
      <GovernanceError error={error} />
      {groups.length === 0 ? (
        <p className="text-body">No SSO group mappings yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-body">
            <thead>
              <tr>
                {["External group ID", "Role", "Actions"].map((label) => (
                  <th className="border-b border-kh-border p-3" key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr className="border-b border-kh-border" key={group.externalGroupId}>
                  <td className="p-3 align-top break-all">{group.externalGroupId}</td>
                  <td className="p-3 align-top">{group.role}</td>
                  <td className="p-3 align-top">
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
