"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import type { TeamWorkspaceView } from "@/server/workspace-admin";
import {
  GovernanceError,
  governanceFailure,
  governanceRequest,
  type GovernanceFailure,
} from "./governance-error";

export function GeneralSettings({ team }: { team: TeamWorkspaceView }) {
  const router = useRouter();
  const toast = useToast();
  const { access, confirmed } = useWorkspaceAuthorization();
  const actions = access.actions;
  const [name, setName] = useState(team.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GovernanceFailure | null>(null);
  useEffect(() => setName(team.name), [team.name]);

  async function request(path: string, method: string, body?: unknown) {
    await governanceRequest(`/api/workspaces/${team.id}${path}`, method, body);
    router.refresh();
  }

  /** Every call here has a reverse operation, so none of them confirms first. */
  async function mutate(
    path: string,
    method: string,
    body: unknown,
    done: { message: string; undo: () => Promise<void> },
  ) {
    if (!confirmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await request(path, method, body);
      toast({ message: done.message, undo: { run: done.undo } });
    } catch (failure) {
      setError(governanceFailure(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="max-w-panel space-y-6">
      <h2 className="text-title font-semibold">General</h2>
      <p className="text-body">State: {access.workspace.lifecycleState}</p>
      {actions.canRename ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            // Captured before the request: undoing a rename means restoring
            // the name this workspace had, not the one in the field.
            const previous = team.name;
            void mutate("", "PATCH", { name }, {
              message: `Renamed to ${name.trim()}.`,
              undo: () => request("", "PATCH", { name: previous }),
            });
          }}
        >
          <label className="block text-body">
            Team name
            <Input
              value={name}
              maxLength={200}
              required
              disabled={busy || !confirmed}
              aria-invalid={error?.field === "name"}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <Button type="submit" disabled={busy || !confirmed || !name.trim()}>
            Save name
          </Button>
        </form>
      ) : (
        <p>Team name: {team.name}</p>
      )}
      {actions.canArchive && (
        <div className="rounded-md border border-kh-danger-border bg-kh-danger-bg p-4">
          <h3 className="font-medium">Archive workspace</h3>
          <p className="my-2 text-body">
            Archiving keeps knowledge readable and stops imports and membership changes. An owner
            can restore it later.
          </p>
          {/* No second step: archiving is reversible, and restore is one click
              away in the toast. A confirmation before an undoable action buys
              nothing and teaches the reader to click through the ones that
              are not. */}
          <Button
            variant="danger"
            disabled={busy || !confirmed}
            onClick={() =>
              void mutate("/archive", "POST", undefined, {
                message: `${team.name} archived.`,
                undo: () => request("/restore", "POST"),
              })
            }
          >
            Archive workspace
          </Button>
        </div>
      )}
      {actions.canRestore && (
        <Button
          disabled={busy || !confirmed}
          onClick={() =>
            void mutate("/restore", "POST", undefined, {
              message: `${team.name} restored.`,
              undo: () => request("/archive", "POST"),
            })
          }
        >
          Restore workspace
        </Button>
      )}
      <GovernanceError error={error} />
    </section>
  );
}
