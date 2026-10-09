"use client";

import { useEffect, useId, useState } from "react";
import { Dialog } from "@base-ui-components/react/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_FOLDER_NAME_LENGTH } from "@/modules/knowledge/domain/tree-rules";
import { FOLDER_NAME_REQUEST_EVENT, type FolderNameRequest } from "./folder-name-request";
import { folderNameProblem } from "./organize-messages";
import { useTreeMutations } from "./use-tree-mutations";
import { dialogBackdropClasses, dialogPopupClasses } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

/**
 * Mounted once by the knowledge layout. One dialog for both jobs that need a name from the reader —
 * a new folder and a rename — because they ask the same question of the same field with the same
 * limits. What the server refuses (a parent archived in the meantime, a source that is now read-only)
 * comes back as words beside the field and leaves the dialog open, so the name typed is not lost.
 */
export function FolderNameDialogHost() {
  const [request, setRequest] = useState<FolderNameRequest | null>(null);
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<FolderNameRequest | undefined>).detail;
      if (detail?.mode === "create" || detail?.mode === "rename") setRequest(detail);
    };
    window.addEventListener(FOLDER_NAME_REQUEST_EVENT, open);
    return () => window.removeEventListener(FOLDER_NAME_REQUEST_EVENT, open);
  }, []);
  return <FolderNameDialog request={request} onClose={() => setRequest(null)} />;
}

function FolderNameDialog({ request, onClose }: { request: FolderNameRequest | null; onClose: () => void }) {
  const mutations = useTreeMutations();
  const errorId = useId();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    setName(request?.mode === "rename" ? request.name : "");
    setProblem(null);
    setBusy(false);
  }, [request]);

  const creating = request?.mode !== "rename";

  async function submit() {
    if (!request || busy) return;
    const found = folderNameProblem(name, MAX_FOLDER_NAME_LENGTH);
    if (found) {
      setProblem(found);
      return;
    }
    // Renaming to what it already is asks the server for nothing.
    if (request.mode === "rename" && name.trim() === request.name) {
      onClose();
      return;
    }
    setBusy(true);
    setProblem(null);
    const result =
      request.mode === "create"
        ? await mutations.createFolder({ name, parentId: request.parentId, sourceId: request.sourceId })
        : await mutations.renameFolder({ nodeId: request.nodeId, from: request.name, to: name });
    setBusy(false);
    if (result.ok) onClose();
    else setProblem(result.message);
  }

  return (
    <Dialog.Root open={request !== null} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className={dialogBackdropClasses()} />
        <Dialog.Popup className={dialogPopupClasses("w-[min(26rem,92vw)]")}>
          <Dialog.Title className="text-title font-semibold">{creating ? "New folder" : "Rename folder"}</Dialog.Title>
          <Dialog.Description className="mt-1 text-body text-kh-text-muted">
            {request?.mode === "create"
              ? request.parentLabel
                ? `It will be created inside “${request.parentLabel}”.`
                : "It will be created at the top level."
              : "Only the name changes; its place and what's inside stay as they are."}
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
                value={name}
                disabled={busy}
                autoComplete="off"
                aria-invalid={problem ? true : undefined}
                aria-describedby={problem ? errorId : undefined}
                onChange={(event) => {
                  setName(event.target.value);
                  setProblem(null);
                }}
              />
            </Label>
            {problem ? (
              <p id={errorId} role="alert" className="mt-2 text-body text-kh-danger">
                {problem}
              </p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? (creating ? "Creating…" : "Renaming…") : creating ? "Create folder" : "Rename"}
              </Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
