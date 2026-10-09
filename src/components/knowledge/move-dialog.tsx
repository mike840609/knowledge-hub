"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Dialog } from "@base-ui-components/react/dialog";
import { Folder } from "lucide-react";
import { Button } from "@/components/ui/button";
import { moveDestinations } from "@/lib/knowledge-navigation";
import type { KnowledgeTreeItem, SourceView } from "@/modules/knowledge/application/knowledge-query-service";
import { organizeFailure } from "./organize-messages";
import { MOVE_REQUEST_EVENT, requestRevealFolder, type MoveRequest } from "./move-request";
import { useTreeMutations } from "./use-tree-mutations";
import { dialogBackdropClasses, dialogPopupClasses } from "@/components/ui/dialog";

type Collections = { source: SourceView; tree: KnowledgeTreeItem[] }[];

/** The top level has no ID; a radio needs a value. Never a real ID: those are UUIDs. */
const TOP = "top";

/**
 * Mounted once by the knowledge layout, beside the share and folder-name dialogs, and asked for the
 * same way (`requestMove`). It has the sidebar's own trees, so the folders it lists are the ones the
 * reader can see — and what it offers is only that: the server decides what happens, and refuses a
 * destination archived or gone since this list was made, in words beside the list.
 */
export function MoveDialogHost({ collections }: { collections: Collections }) {
  const [request, setRequest] = useState<MoveRequest | null>(null);
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<MoveRequest | undefined>).detail;
      if (detail && typeof detail.sourceId === "string" && detail.node) setRequest(detail);
    };
    window.addEventListener(MOVE_REQUEST_EVENT, open);
    return () => window.removeEventListener(MOVE_REQUEST_EVENT, open);
  }, []);
  return <MoveDialog request={request} collections={collections} onClose={() => setRequest(null)} />;
}

function MoveDialog({ request, collections, onClose }: { request: MoveRequest | null; collections: Collections; onClose: () => void }) {
  const mutations = useTreeMutations();
  const errorId = useId();
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    setSelected(null);
    setProblem(null);
    setBusy(false);
  }, [request]);

  // Where the node is in the tree now, from the tree the reader is looking at.
  const found = useMemo(() => {
    if (!request) return null;
    const tree = collections.find((collection) => collection.source.id === request.sourceId)?.tree;
    const item = tree?.find((candidate) =>
      request.node.type === "document"
        ? candidate.type === "document" && candidate.documentId === request.node.documentId
        : candidate.id === request.node.nodeId,
    );
    return tree && item ? { item, destinations: moveDestinations(tree, item.id) } : null;
  }, [request, collections]);

  const kind = request?.node.type === "folder" ? "folder" : "document";
  const label = request?.label ?? "";

  async function submit() {
    if (!request || !found || selected === null || busy) return;
    const toParentId = selected === TOP ? null : selected;
    if (toParentId === found.item.parentId) return;
    const destination = toParentId === null ? null : found.destinations.find((candidate) => candidate.id === toParentId)?.label ?? null;
    setBusy(true);
    setProblem(null);
    const result = await mutations.moveNode({
      nodeId: found.item.id,
      label,
      from: { parentId: found.item.parentId, position: found.item.position },
      to: { parentId: toParentId, label: destination },
    });
    setBusy(false);
    if (result.ok) {
      // Where it went is shown open, not behind a folder that was collapsed.
      if (toParentId !== null) requestRevealFolder(toParentId);
      onClose();
    } else setProblem(result.message);
  }

  const option = (id: string, name: string, depth: number, disabled: boolean) => (
    <label
      key={id}
      className="relative flex min-h-8 cursor-pointer items-center gap-2 rounded-md pr-2 text-body hover:bg-kh-bg-hover has-[:checked]:bg-kh-bg-selected has-[:checked]:font-medium has-[:checked]:text-kh-selected-text has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-kh-focus has-[:disabled]:cursor-default has-[:disabled]:text-kh-text-muted has-[:disabled]:hover:bg-transparent"
      style={{ paddingLeft: `${0.5 + depth}rem` }}
    >
      <input
        type="radio"
        name="destination"
        value={id}
        className="sr-only"
        disabled={disabled || busy}
        checked={selected === id}
        onChange={() => {
          setSelected(id);
          setProblem(null);
        }}
      />
      <Folder size={14} className="shrink-0 text-kh-text-muted" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {disabled ? <span className="shrink-0 text-caption font-normal text-kh-text-muted">Current</span> : null}
    </label>
  );

  return (
    <Dialog.Root open={request !== null} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className={dialogBackdropClasses()} />
        <Dialog.Popup className={dialogPopupClasses("w-[min(26rem,92vw)]")}>
          <Dialog.Title className="text-title font-semibold">{kind === "folder" ? "Move folder" : "Move document"}</Dialog.Title>
          {found ? (
            <>
              <Dialog.Description className="mt-1 text-body text-kh-text-muted">
                {`Choose where “${label}” goes. It will be placed last.`}
              </Dialog.Description>
              <form
                className="mt-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                <fieldset
                  className="max-h-72 min-w-0 space-y-0.5 overflow-y-auto rounded-md border border-kh-border p-1"
                  // A radio does not submit the form on Enter in every browser; a reader who has arrowed to
                  // a folder expects Enter to move there, so it is said here rather than left to the browser.
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    void submit();
                  }}
                >
                  <legend className="sr-only">Destination</legend>
                  {option(TOP, "Top level", 0, found.item.parentId === null)}
                  {found.destinations.map((destination) => option(destination.id, destination.label, destination.depth + 1, destination.id === found.item.parentId))}
                </fieldset>
                {problem ? (
                  <p id={errorId} role="alert" className="mt-2 text-body text-kh-danger">
                    {problem}
                  </p>
                ) : null}
                <div className="mt-5 flex justify-end gap-2">
                  <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={busy || selected === null}>
                    {busy ? "Moving…" : "Move"}
                  </Button>
                </div>
              </form>
            </>
          ) : (
            <>
              <Dialog.Description role="alert" className="mt-1 text-body text-kh-danger">
                {organizeFailure({ code: "NOT_FOUND", message: "" })}
              </Dialog.Description>
              <div className="mt-5 flex justify-end">
                <Button type="button" variant="ghost" onClick={onClose}>
                  Close
                </Button>
              </div>
            </>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
