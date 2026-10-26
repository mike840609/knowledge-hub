"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@base-ui-components/react/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dialogBackdropClasses, dialogPopupClasses } from "@/components/ui/dialog";
import { requestSourceRename } from "./rename-source-request";

/**
 * The rename entry for the actions menu, which does not own the row's title.
 * The detail header edits in place instead; both go through the same request.
 */
export function RenameSourceDialog({ open, onOpenChange, sourceId, name }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceId: string;
  name: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    if (!open) return;
    setValue(name);
    setProblem("");
    setBusy(false);
  }, [open, name]);

  async function submit() {
    if (busy) return;
    const next = value.trim();
    if (!next) {
      setProblem("Enter a name.");
      return;
    }
    if (next === name) {
      onOpenChange(false);
      return;
    }
    setBusy(true);
    setProblem("");
    try {
      await requestSourceRename(sourceId, next);
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Could not rename the source.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className={dialogBackdropClasses()} />
        <Dialog.Popup className={dialogPopupClasses("w-[min(26rem,92vw)]")}>
          <Dialog.Title className="text-title font-semibold">Rename source</Dialog.Title>
          <Dialog.Description className="mt-1 text-body text-kh-text-muted">
            Only the name changes; its place and what&apos;s inside stay as they are.
          </Dialog.Description>
          <form
            className="mt-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <Label>
              Name
              <Input
                className="mt-1"
                aria-label="Source name"
                value={value}
                disabled={busy}
                autoComplete="off"
                aria-invalid={problem ? true : undefined}
                onChange={(event) => {
                  setValue(event.target.value);
                  setProblem("");
                }}
              />
            </Label>
            {problem ? <p role="alert" className="mt-2 text-body text-kh-danger">{problem}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>{busy ? "Renaming…" : "Rename"}</Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
