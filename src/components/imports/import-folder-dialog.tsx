"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Dialog } from "@base-ui-components/react/dialog";
import { dialogBackdropClasses, dialogPopupClasses } from "@/components/ui/dialog";
import { DialogCloseButton } from "@/components/ui/dialog-close";
import { FolderImportForm, type FolderImportClientLimits } from "./folder-import-form";

export function ImportFolderDialog({
  workspaceId,
  canImport,
  limits,
}: {
  workspaceId: string;
  canImport: boolean;
  limits: FolderImportClientLimits;
}): React.JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (!busy) return;
    const blockSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", blockSearch, true);
    return () => window.removeEventListener("keydown", blockSearch, true);
  }, [busy]);

  function requestClose(): void {
    // Close locally first: a history entry that refuses to navigate must not
    // leave the dialog on screen with no way out.
    if (busy || !open) return;
    setOpen(false);
    router.back();
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) requestClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className={dialogBackdropClasses()} />
        <Dialog.Popup className={dialogPopupClasses("w-[min(40rem,92vw)] max-h-[85vh] overflow-y-auto")}>
          <Dialog.Title className="text-title font-semibold">Import folder</Dialog.Title>
          <Dialog.Description className="mt-1 text-body text-kh-text-muted">
            Your local files stay unchanged.{" "}
            {busy ? (
              <span>Folder format guide</span>
            ) : (
              <Link
                className="rounded-md text-kh-link underline-offset-4 hover:underline kh-focus-ring"
                href="/help#format-reference"
              >
                Folder format guide
              </Link>
            )}
          </Dialog.Description>
          <div className="mt-5">
            {canImport ? (
              <FolderImportForm
                target={{ kind: "new", workspaceId }}
                limits={limits}
                onBusyChange={setBusy}
                replaceOnComplete
              />
            ) : (
              <p role="status" className="text-body text-kh-text-muted">
                This workspace is read-only. Import is unavailable.
              </p>
            )}
          </div>
          <DialogCloseButton disabled={busy} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
