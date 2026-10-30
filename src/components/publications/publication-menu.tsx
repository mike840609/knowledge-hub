"use client";

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button, buttonClasses } from "@/components/ui/button";
import { Dialog } from "@base-ui-components/react/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { dialogBackdropClasses, dialogPopupClasses } from "@/components/ui/dialog";
import { DialogCloseButton } from "@/components/ui/dialog-close";
import type { PublicationListItem } from "@/modules/sources/application/publication-service";
import { JoinDialog, type JoinFolderOption } from "./join-dialog";
import { PUBLICATION_COPY } from "./publication-entry-meta";

async function command(url: string, body?: unknown): Promise<string | null> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.ok) return null;
    const parsed = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    return parsed?.error?.message ?? "操作失敗，請再試一次。";
  } catch {
    return "操作失敗，請再試一次。";
  }
}

/**
 * One publication's menu. Which rows exist follows the server's own answer in
 * the list item: join for an eligible folder publication, leave/resume for the
 * caller's own contribution, and unpublish/restore/rename for its creator or
 * an admin. The server still refuses anything not offered here.
 */
export function PublicationMenu({
  item,
  folders = [],
  onChanged,
}: {
  item: PublicationListItem;
  folders?: readonly JoinFolderOption[];
  onChanged?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [name, setName] = useState(item.publication.name);
  const [error, setError] = useState<string>();

  const own = item.ownContribution;
  const hasContribution = own !== null;
  const left = own?.leftAt !== null && own?.leftAt !== undefined;
  const actions: Array<{ id: string; label: string; run: () => void }> = [];
  if (item.canJoin) actions.push({ id: "join", label: PUBLICATION_COPY.join, run: () => setJoinOpen(true) });
  if (hasContribution && left) actions.push({ id: "resume", label: PUBLICATION_COPY.resume, run: () => void change("resume", `/api/publications/${item.publication.id}/resume`) });
  if (hasContribution && !left) actions.push({ id: "leave", label: PUBLICATION_COPY.left, run: () => void change("leave", `/api/publications/${item.publication.id}/leave`) });
  if (item.canManage && item.publication.status === "ACTIVE") actions.push({ id: "unpublish", label: PUBLICATION_COPY.unpublish, run: () => void change("unpublish", `/api/publications/${item.publication.id}/unpublish`) });
  if (item.canManage && item.publication.status === "ARCHIVED") actions.push({ id: "restore", label: PUBLICATION_COPY.restore, run: () => void change("restore", `/api/publications/${item.publication.id}/restore`) });
  if (item.canManage) actions.push({ id: "rename", label: PUBLICATION_COPY.rename, run: () => { setName(item.publication.name); setRenameOpen(true); } });

  async function change(id: string, url: string, body?: unknown) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    const failure = await command(url, body);
    setBusy(false);
    if (failure) {
      setError(failure);
      return;
    }
    if (id === "rename") setRenameOpen(false);
    if (id === "join") setJoinOpen(false);
    toast({ message: "已更新團隊發佈。" });
    onChanged?.();
    router.refresh();
  }

  if (actions.length === 0) return null;

  return (
    <>
      <MenuRoot>
        <MenuTrigger
          aria-label={`${item.publication.name} 的發佈操作`}
          className={buttonClasses({ variant: "ghost", icon: true })}
        >
          <MoreHorizontal size={14} aria-hidden="true" />
        </MenuTrigger>
        <MenuContent align="end" className="w-52">
          {actions.map((action) => (
            <MenuItem key={action.id} onClick={action.run} disabled={busy} data-publication-action={action.id}>
              {action.label}
            </MenuItem>
          ))}
          {error ? <MenuSeparator /> : null}
          {error ? <p role="alert" className="px-2 py-1 text-caption text-kh-danger">{error}</p> : null}
        </MenuContent>
      </MenuRoot>
      {item.canJoin ? (
        <JoinDialog
          open={joinOpen}
          onOpenChange={setJoinOpen}
          publication={{ publicationId: item.publication.id, name: item.publication.name }}
          folders={folders}
          onJoined={() => { onChanged?.(); router.refresh(); }}
        />
      ) : null}
      <Dialog.Root open={renameOpen} onOpenChange={(next) => { if (!busy) setRenameOpen(next); }}>
        <Dialog.Portal>
          <Dialog.Backdrop className={dialogBackdropClasses()} />
          <Dialog.Popup className={dialogPopupClasses("w-[min(28rem,92vw)]")}>
            <Dialog.Title className="text-title font-semibold">{PUBLICATION_COPY.rename}</Dialog.Title>
            <form
              className="mt-5 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void change("rename", `/api/publications/${item.publication.id}/rename`, { name });
              }}
            >
              <Label>
                發佈名稱
                <Input autoFocus value={name} maxLength={200} required disabled={busy} onChange={(event) => setName(event.target.value)} />
              </Label>
              {error ? <p role="alert" className="text-body text-kh-danger">{error}</p> : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" disabled={busy} onClick={() => setRenameOpen(false)}>取消</Button>
                <Button type="submit" disabled={busy || !name.trim()}>{busy ? "儲存中…" : "儲存"}</Button>
              </div>
            </form>
            <DialogCloseButton disabled={busy} />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
