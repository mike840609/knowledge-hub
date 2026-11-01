"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "@base-ui-components/react/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SelectMenu } from "@/components/ui/select-menu";
import { dialogBackdropClasses, dialogPopupClasses } from "@/components/ui/dialog";
import { DialogCloseButton } from "@/components/ui/dialog-close";
import { PUBLICATION_COPY } from "./publication-entry-meta";

export type JoinFolderOption = { folderNodeId: string; label: string };

async function failureOf(response: Response): Promise<{ code?: string; message?: string } | null> {
  try {
    const body = await response.json() as { error?: { code?: string; message?: string } };
    return body.error ?? null;
  } catch {
    return null;
  }
}

/**
 * 「加入」: share an existing folder publication from one of the caller's own
 * My Space folders. A low path overlap is a warning, not a refusal: joining
 * again needs the caller's explicit acknowledgement, because the wrong folder
 * is exactly the mistake the comparison exists to catch.
 */
export function JoinDialog({
  open,
  onOpenChange,
  publication,
  folders,
  onJoined,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  publication: { publicationId: string; name: string };
  /** The caller's own folders. Absent, they are read from the options route when the dialog opens. */
  folders?: readonly JoinFolderOption[];
  onJoined?: (result: { contributionId: string }) => void;
}) {
  const [loadedFolders, setLoadedFolders] = useState<readonly JoinFolderOption[]>(folders ?? []);
  const [folderNodeId, setFolderNodeId] = useState(folders?.length === 1 ? folders[0].folderNodeId : "");
  const [acknowledged, setAcknowledged] = useState(false);
  const [lowOverlap, setLowOverlap] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const foldersKey = folders?.map((folder) => folder.folderNodeId).join(",") ?? "";

  useEffect(() => {
    if (!open) return;
    setLowOverlap(false);
    setAcknowledged(false);
    setError(undefined);
    setBusy(false);
    submitting.current = false;
    if (folders !== undefined) {
      setLoadedFolders(folders);
      setFolderNodeId(folders.length === 1 ? folders[0].folderNodeId : "");
      return;
    }
    let current = true;
    setLoadedFolders([]);
    setFolderNodeId("");
    void (async () => {
      try {
        const response = await fetch("/api/publications/options", { cache: "no-store" });
        if (!response.ok) return;
        const options = await response.json() as { folders?: JoinFolderOption[] };
        const next = options.folders ?? [];
        if (!current) return;
        setLoadedFolders(next);
        if (next.length === 1) setFolderNodeId(next[0].folderNodeId);
      } catch {
        // An empty picker is honest; publish/join still decides.
      }
    })();
    return () => { current = false; };
    // The folder set is fixed for the life of one opening.
  }, [open, publication.publicationId, foldersKey]);

  function chooseFolder(next: string) {
    setFolderNodeId(next);
    // A warning belongs to the folder it was raised for: choosing another one
    // must not carry the acknowledgement over.
    setLowOverlap(false);
    setAcknowledged(false);
    setError(undefined);
  }

  async function join() {
    if (busy || submitting.current || !folderNodeId) return;
    if (lowOverlap && !acknowledged) return;
    submitting.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/publications/${publication.publicationId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderNodeId,
          ...(lowOverlap ? { acknowledgeLowOverlap: true } : {}),
        }),
      });
      if (!response.ok) {
        const failure = await failureOf(response);
        if (failure?.code === "PUBLICATION_JOIN_LOW_OVERLAP") {
          setLowOverlap(true);
          setAcknowledged(false);
        } else {
          setError(failure?.message ?? "加入失敗，請再試一次。");
        }
        return;
      }
      const body = await response.json() as { contributionId: string };
      onJoined?.(body);
      onOpenChange(false);
    } catch {
      setError("加入失敗，請再試一次。");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className={dialogBackdropClasses()} />
        <Dialog.Popup className={dialogPopupClasses("w-[min(32rem,92vw)]")}>
          <Dialog.Title className="text-title font-semibold">加入「{publication.name}」</Dialog.Title>
          <Dialog.Description className="mt-1 text-body text-kh-text-muted">
            選擇你在 My Space 中持有同一份 repo 的資料夾。只有你的原稿所建立的文件由你維護。
          </Dialog.Description>
          <form className="mt-5 space-y-4" onSubmit={(event) => { event.preventDefault(); void join(); }}>
            <Label>
              你的資料夾
              <SelectMenu
                aria-label="你的資料夾"
                value={folderNodeId}
                disabled={busy}
                onValueChange={chooseFolder}
                options={[
                  { value: "", label: loadedFolders.length === 0 ? "沒有可加入的資料夾" : "選擇資料夾" },
                  ...loadedFolders.map((folder) => ({ value: folder.folderNodeId, label: folder.label })),
                ]}
              />
            </Label>
            {lowOverlap ? (
              <div data-publication-low-overlap="" className="space-y-2 border-t border-kh-border pt-3">
                <p role="alert" className="text-body text-kh-warning">{PUBLICATION_COPY.lowOverlap}</p>
                <label className="flex items-start gap-2 text-body text-kh-text">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    disabled={busy}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                  />
                  {PUBLICATION_COPY.lowOverlapAcknowledge}
                </label>
              </div>
            ) : null}
            {error ? <p role="alert" className="text-body text-kh-danger">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button
                type="submit"
                disabled={busy || !folderNodeId || (lowOverlap && !acknowledged)}
              >
                {busy ? "加入中…" : lowOverlap ? "仍要加入" : PUBLICATION_COPY.join}
              </Button>
            </div>
          </form>
          <DialogCloseButton disabled={busy} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
