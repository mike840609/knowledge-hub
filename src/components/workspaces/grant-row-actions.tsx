"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import {
  GovernanceError,
  governanceFailure,
  governanceRequest,
  type GovernanceFailure,
} from "./governance-error";
export function GrantRowActions({
  role,
  roles,
  canRemove,
  url,
  identityBody,
  label,
  member = false,
}: {
  role: string;
  roles: readonly string[];
  canRemove: boolean;
  url: string;
  identityBody?: { externalGroupId: string };
  label: string;
  member?: boolean;
}) {
  const { access, confirmed } = useWorkspaceAuthorization();
  const router = useRouter();
  const [nextRole, setNextRole] = useState(role);
  const [confirm, setConfirm] = useState<"role" | "remove" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GovernanceFailure | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    setNextRole(role);
    setConfirm(null);
  }, [role]);
  const allowed =
    confirmed &&
    access.workspace.lifecycleState === "ACTIVE" &&
    (member ? access.actions.canManageBasicMembers : access.actions.canManageBasicGroups);
  async function save() {
    if (!allowed || busy || !confirm) return;
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      await governanceRequest(
        url,
        confirm === "remove" ? "DELETE" : "PATCH",
        confirm === "remove" ? identityBody : { ...identityBody, role: nextRole },
      );
      setConfirm(null);
      setNotice("Access updated.");
      router.refresh();
    } catch (failure) {
      setError(governanceFailure(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="min-w-52 space-y-2">
      {allowed && (
        <>
          <div className="flex flex-wrap gap-2">
            {roles.length > 0 && (
              <>
                <Select
                  aria-label={`Role for ${label}`}
                  value={nextRole}
                  disabled={busy}
                  onChange={(event) => setNextRole(event.target.value)}
                >
                  {!roles.includes(role) && (
                    <option value={role} disabled>
                      {role}
                    </option>
                  )}
                  {roles.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </Select>
                <Button
                  disabled={busy || nextRole === role || !roles.includes(nextRole)}
                  onClick={() => setConfirm("role")}
                >
                  Change role
                </Button>
              </>
            )}
            {canRemove && (
              <Button variant="secondary" disabled={busy} onClick={() => setConfirm("remove")}>
                Remove
              </Button>
            )}
          </div>
          {confirm && (
            <div className="rounded-md border border-kh-border p-3">
              <p className="text-body">
                {confirm === "remove"
                  ? `Remove ${member ? "direct access for" : "group mapping for"} ${label}?`
                  : `Change ${label} from ${role} to ${nextRole}?`}
              </p>
              {member && confirm === "remove" && (
                <p className="my-2 text-body">
                  Removing direct access may not fully revoke access if this user is still granted
                  access through an SSO group.
                </p>
              )}
              <div className="mt-2 flex gap-2">
                <Button disabled={busy} onClick={() => void save()}>
                  Confirm {confirm === "remove" ? "remove" : "change"}
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => setConfirm(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      <GovernanceError error={error} />
      <p role="status" className="text-body">
        {notice}
      </p>
    </div>
  );
}
