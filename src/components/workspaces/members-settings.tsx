"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SelectMenu } from "@/components/ui/select-menu";
import { useToast } from "@/components/ui/toast";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import type { HubUserLookup, MemberAdminView, TeamWorkspaceView } from "@/server/workspace-admin";
import {
  GovernanceError,
  governanceFailure,
  governanceRequest,
  type GovernanceFailure,
} from "./governance-error";
import { GrantRowActions } from "./grant-row-actions";
export function MembersSettings({
  team,
  members,
}: {
  team: TeamWorkspaceView;
  members: readonly MemberAdminView[];
}) {
  const router = useRouter();
  const toast = useToast();
  const { access, confirmed } = useWorkspaceAuthorization();
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<HubUserLookup[]>([]);
  const [selected, setSelected] = useState("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [matchedUserCount, setMatchedUserCount] = useState(0);
  const searchGeneration = useRef(0);
  const [error, setError] = useState<GovernanceFailure | null>(null);
  const roles = team.grantOptions.newMemberAssignableRoles;
  const chosenRole = roles.find((value) => value === role) ?? roles[0] ?? "";
  const canAdd =
    access.actions.canManageBasicMembers &&
    access.workspace.lifecycleState === "ACTIVE" &&
    roles.length > 0;
  const memberUrl = (userId: string) => `/api/workspaces/${team.id}/members/${userId}`;
  async function grantMember(userId: string, role: string) {
    await governanceRequest(`/api/workspaces/${team.id}/members`, "POST", { userId, role });
    router.refresh();
  }
  async function setMemberRole(userId: string, role: string) {
    await governanceRequest(memberUrl(userId), "PATCH", { role });
    router.refresh();
  }
  async function removeMember(userId: string) {
    await governanceRequest(memberUrl(userId), "DELETE");
    router.refresh();
  }

  async function search() {
    const generation = ++searchGeneration.current;
    setSearching(true);
    setSearched(false);
    setCandidates([]);
    setError(null);
    setSelected("");
    try {
      const users = await governanceRequest<HubUserLookup[]>(
        `/api/users?query=${encodeURIComponent(query.trim())}&limit=20`,
      );
      if (generation === searchGeneration.current) {
        setMatchedUserCount(users.length);
        setCandidates(
          users.filter((user) => !members.some((member) => member.user.id === user.id)),
        );
        setSearched(true);
      }
    } catch (failure) {
      if (generation === searchGeneration.current) setError(governanceFailure(failure));
    } finally {
      if (generation === searchGeneration.current) setSearching(false);
    }
  }
  return (
    <section className="space-y-6">
      <h2 className="text-title font-semibold">Members</h2>
      {canAdd && (
        <details className="max-w-panel border-b border-kh-border pb-3">
          <summary className="kh-focus-ring w-fit cursor-pointer rounded-md text-body font-medium">Add member</summary>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void search();
            }}
          >
            <Input
              aria-label="Search existing users"
              placeholder="Name or employee ID"
              value={query}
              disabled={!confirmed || busy}
              onChange={(event) => {
                ++searchGeneration.current;
                setSearching(false);
                setQuery(event.target.value);
                setCandidates([]);
                setSelected("");
                setSearched(false);
              }}
            />
            <Button type="submit" disabled={!confirmed || busy || searching || !query.trim()}>
              Search
            </Button>
          </form>
          {searched && candidates.length === 0 && (
            <p role="status" className="mt-2 text-body">{matchedUserCount > 0 ? "Matching users are already members of this workspace. Try another name or employee ID." : "No users match this search. Try another name or employee ID."}</p>
          )}
          {candidates.length > 0 && (
            <form
              className="mt-3 flex flex-wrap gap-2"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!confirmed || busy || !selected || !chosenRole) return;
                const added = candidates.find((user) => user.id === selected);
                const userId = selected;
                const role = chosenRole;
                setBusy(true);
                setError(null);
                try {
                  await grantMember(userId, role);
                  setCandidates([]);
                  setSelected("");
                  setQuery("");
                  setSearched(false);
                  toast({
                    message: `${added?.name ?? "Member"} added as ${role}.`,
                    undo: { run: () => removeMember(userId) },
                  });
                } catch (failure) {
                  setError(governanceFailure(failure));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <SelectMenu
                aria-label="User to add"
                value={selected}
                disabled={busy || !confirmed}
                onValueChange={setSelected}
                options={[
                  { value: "", label: "Select a user" },
                  ...candidates.map((user) => ({ value: user.id, label: `${user.name} (${user.empId})` })),
                ]}
              />
              <SelectMenu
                aria-label="New member role"
                value={chosenRole}
                disabled={busy || !confirmed}
                onValueChange={setRole}
                options={roles.map((value) => ({ value, label: value }))}
              />
              <Button type="submit" disabled={busy || !confirmed || !selected}>
                Add member
              </Button>
            </form>
          )}
        </details>
      )}
      <p className="text-caption text-kh-text-muted">{members.length} members · Direct roles can be changed here. Group access comes from SSO and is managed in SSO Groups.</p>
      <GovernanceError error={error} />
      <div className="overflow-x-auto">
        <table className="w-full text-left text-body">
          <thead className="hidden sm:table-header-group">
            <tr>
              {["Name", "Direct role", "Group access", "Actions"].map((label) => (
                <th className="border-b border-kh-border px-3 py-2 text-caption font-medium text-kh-text-muted" key={label}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="block sm:table-row-group">
            {members.map((member) => (
              <tr className="grid grid-cols-2 gap-x-3 border-b border-kh-border py-2 sm:table-row sm:py-0" key={member.user.id}>
                <td className="block px-3 py-2 align-top sm:table-cell">
                  {member.user.name}
                  <span className="block text-caption text-kh-text-muted">{member.user.empId}</span>
                </td>
                <td className="block px-3 py-2 align-top sm:table-cell"><span className="block text-caption text-kh-text-muted sm:hidden">Direct role</span>{member.access.directRole ?? "No direct role"}</td>
                <td className="col-span-2 block px-3 py-2 align-top sm:table-cell"><span className="block text-caption text-kh-text-muted sm:hidden">Group access</span>
                  {member.access.groupAccess === "UNKNOWN_NOT_EVALUATED"
                    ? "Group access not evaluated"
                    : member.access.matchedGroups?.length
                      ? member.access.matchedGroups
                          .map((group) => `${group.externalGroupId}: ${group.role}`)
                          .join(", ")
                      : "No matching group grants"}
                </td>
                <td className="col-span-2 block px-3 py-2 align-top sm:table-cell">
                  <GrantRowActions
                    role={member.access.directRole ?? ""}
                    roles={member.assignableRoles}
                    canRemove={member.canRemoveDirectAccess}
                    label={member.user.name}
                    member
                    onChangeRole={(role) => setMemberRole(member.user.id, role)}
                    onRemove={() => removeMember(member.user.id)}
                    onRestore={(role) => grantMember(member.user.id, role)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
