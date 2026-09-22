"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import {
  GovernanceError,
  governanceFailure,
  type GovernanceFailure,
} from "./governance-error";

/**
 * Both of these are reversible — a role can be set back, a grant can be
 * granted again — so both act at once and offer undo rather than asking
 * twice.
 *
 * The three operations arrive as callbacks because undoing a removal is not
 * the reverse *call* of removing: `PATCH` on a membership that no longer
 * exists is rejected, so restoring one goes through the add endpoint. The
 * settings components already build those URLs; a `url` prop here could only
 * have guessed at the third.
 *
 * The role restored is the one held before the change, captured at the click.
 * Reading it back afterwards would read whatever the row shows now.
 */
export function GrantRowActions({
  role,
  roles,
  canRemove,
  label,
  member = false,
  onChangeRole,
  onRemove,
  onRestore,
}: {
  role: string;
  roles: readonly string[];
  canRemove: boolean;
  label: string;
  member?: boolean;
  onChangeRole: (role: string) => Promise<void>;
  onRemove: () => Promise<void>;
  onRestore: (role: string) => Promise<void>;
}) {
  const { access, confirmed } = useWorkspaceAuthorization();
  const toast = useToast();
  const [nextRole, setNextRole] = useState(role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GovernanceFailure | null>(null);
  useEffect(() => setNextRole(role), [role]);
  const allowed =
    confirmed &&
    access.workspace.lifecycleState === "ACTIVE" &&
    (member ? access.actions.canManageBasicMembers : access.actions.canManageBasicGroups);

  async function run(
    action: () => Promise<void>,
    done: { message: string; undo?: () => Promise<void> },
  ) {
    if (!allowed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      toast({ message: done.message, undo: done.undo ? { run: done.undo } : undefined });
    } catch (failure) {
      setError(governanceFailure(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-52 space-y-2">
      {allowed && (
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
                onClick={() => {
                  const previous = role;
                  const assigned = nextRole;
                  void run(() => onChangeRole(assigned), {
                    message: `${label} is now ${assigned}.`,
                    undo: previous ? () => onChangeRole(previous) : undefined,
                  });
                }}
              >
                Change role
              </Button>
            </>
          )}
          {canRemove && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                const previous = role;
                void run(onRemove, {
                  message: member
                    ? `Direct access removed for ${label}. Access through an SSO group is unaffected.`
                    : `Group mapping removed for ${label}.`,
                  // Restoring is a new grant, and the audit trail says so —
                  // that is what actually happened. Offered only when there
                  // was a role to restore.
                  undo: previous ? () => onRestore(previous) : undefined,
                });
              }}
            >
              Remove
            </Button>
          )}
        </div>
      )}
      <GovernanceError error={error} />
    </div>
  );
}
