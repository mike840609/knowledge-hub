"use client";
import { useState } from "react";
import { Dialog } from "@base-ui-components/react/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  GovernanceError,
  governanceFailure,
  governanceRequest,
  type GovernanceFailure,
} from "./governance-error";
import { dialogBackdropClasses, dialogPopupClasses } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

export function CreateTeamDialog({
  open,
  onOpenChange,
  onCreated,
  onDenied,
  canCreateTeam,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
  onDenied?: () => void;
  canCreateTeam: boolean;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GovernanceFailure | null>(null);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!busy) {
          onOpenChange(next);
          if (!next) {
            setName("");
            setError(null);
          }
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={dialogBackdropClasses()} />
        <Dialog.Popup className={dialogPopupClasses("w-[min(28rem,90vw)]")}>
          <Dialog.Title className="text-title font-semibold">Create team</Dialog.Title>
          <Dialog.Description className="mt-1 text-body text-kh-text-muted">
            Create a shared knowledge workspace. You can add members and SSO groups in Settings.
          </Dialog.Description>
          <form
            className="mt-5 space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy || !canCreateTeam) return;
              setBusy(true);
              setError(null);
              try {
                const result = await governanceRequest<{ id: string }>("/api/workspaces", "POST", {
                  name,
                });
                setName("");
                onOpenChange(false);
                onCreated(result.id);
              } catch (failure) {
                const info = governanceFailure(failure);
                setError(info);
                if (info.code === "TEAM_CREATION_DENIED") onDenied?.();
              } finally {
                setBusy(false);
              }
            }}
          >
            <Label>
              Team name
              <Input
                autoFocus
                value={name}
                maxLength={200}
                required
                disabled={busy}
                aria-invalid={error?.field === "name"}
                onChange={(event) => setName(event.target.value)}
              />
            </Label>
            <GovernanceError error={error} />
            {!canCreateTeam && (
              <p role="status" className="text-body">
                Team creation is no longer available for your account.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                type="button"
                disabled={busy}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !canCreateTeam || !name.trim()}>
                {busy ? "Creating…" : "Create team"}
              </Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
