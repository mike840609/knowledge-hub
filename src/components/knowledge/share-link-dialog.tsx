"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "@base-ui-components/react/dialog";
import { SHARE_REQUEST_EVENT, writeLinkToClipboard, type ShareTarget } from "@/components/actions/action-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { Timestamp } from "@/components/ui/timestamp";
import { useToast } from "@/components/ui/toast";
import {
  GovernanceError,
  governanceFailure,
  governanceRequest,
  type GovernanceFailure,
} from "@/components/workspaces/governance-error";
import { dialogBackdropClasses, dialogPopupClasses } from "@/components/ui/dialog";
import { DialogCloseButton } from "@/components/ui/dialog-close";
import { Label } from "@/components/ui/label";
import { ShareLinksSkeleton } from "./knowledge-skeletons";
import { announceShareLinksChanged } from "./shared-folders";

type ShareLink = {
  id: string;
  label: string | null;
  path: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  active: boolean;
  totalViews: number;
  lastViewedAt: string | null;
};

const EXPIRY_OPTIONS = [
  { days: 1, label: "1 day" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
] as const;

const DEFAULT_EXPIRY_DAYS = 30;

/** A shared folder a document is also visible through (folder share spec §8). */
type ViaFolder = { folderNodeId: string; name: string };

const targetKey = (target: ShareTarget | null) => (target === null ? null : "documentId" in target ? `document:${target.documentId}` : `folder:${target.folderNodeId}`);
const linksUrl = (target: ShareTarget) => ("documentId" in target ? `/api/documents/${target.documentId}/share-links` : `/api/tree-nodes/${target.folderNodeId}/share-links`);

function parseTarget(detail: Partial<{ documentId: unknown; folderNodeId: unknown; name: unknown }> | null | undefined): ShareTarget | null {
  if (typeof detail?.documentId === "string") return { documentId: detail.documentId };
  if (typeof detail?.folderNodeId === "string") return { folderNodeId: detail.folderNodeId, name: typeof detail.name === "string" ? detail.name : undefined };
  return null;
}

/**
 * Mounted once by the knowledge layout. Any surface — row menu, palette,
 * document header — opens it through requestShare(), the same way they ask
 * for the details panel.
 */
export function ShareLinkDialogHost() {
  const [target, setTarget] = useState<ShareTarget | null>(null);
  useEffect(() => {
    const open = (event: Event) => {
      const next = parseTarget((event as CustomEvent<Parameters<typeof parseTarget>[0]>).detail);
      if (next) setTarget(next);
    };
    window.addEventListener(SHARE_REQUEST_EVENT, open);
    return () => window.removeEventListener(SHARE_REQUEST_EVENT, open);
  }, []);
  return (
    <ShareLinkDialog
      target={target}
      onRetarget={setTarget}
      onOpenChange={(next) => {
        if (!next) setTarget(null);
      }}
    />
  );
}

export function ShareLinkDialog({
  target,
  onOpenChange,
  onRetarget,
}: {
  target: ShareTarget | null;
  onOpenChange: (open: boolean) => void;
  /** Where "Also visible through the shared folder" goes: the same dialog, for that folder. */
  onRetarget?: (target: ShareTarget) => void;
}) {
  const toast = useToast();
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [label, setLabel] = useState("");
  const [expiresInDays, setExpiresInDays] = useState<number>(DEFAULT_EXPIRY_DAYS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GovernanceFailure | null>(null);
  const [confirmingRevoke, setConfirmingRevoke] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [reviewCapability, setReviewCapability] = useState({ read: false, write: false });
  const [origin, setOrigin] = useState("");
  const [viaFolders, setViaFolders] = useState<ViaFolder[]>([]);
  // The document or folder the dialog is open for right now. A response for any
  // other — the dialog was closed and reopened elsewhere before it arrived — is
  // dropped rather than shown with this one's buttons.
  const key = targetKey(target);
  const current = useRef<string | null>(key);
  current.current = key;
  const isFolder = target !== null && "folderNodeId" in target;
  const folderName = target !== null && "folderNodeId" in target ? target.name : undefined;

  const load = useCallback(async (next: ShareTarget) => {
    const loadingKey = targetKey(next);
    try {
      const result = await governanceRequest<{ links: ShareLink[]; viaFolders?: ViaFolder[]; reviewReadAvailable?: boolean; reviewWritesEnabled?: boolean }>(linksUrl(next));
      if (current.current !== loadingKey) return;
      setLinks(result.links);
      setViaFolders(Array.isArray(result.viaFolders) ? result.viaFolders : []);
      setReviewCapability({ read: result.reviewReadAvailable === true, write: result.reviewWritesEnabled === true });
    } catch (failure) {
      if (current.current === loadingKey) setError(governanceFailure(failure));
    }
  }, []);

  // Keyed on the target's identity, not the object: the host hands the same folder a new object per request.
  const targetRef = useRef(target);
  targetRef.current = target;
  useEffect(() => {
    setOrigin(window.location.origin);
    setLinks(null);
    setViaFolders([]);
    setReviewCapability({ read: false, write: false });
    setLabel("");
    setExpiresInDays(DEFAULT_EXPIRY_DAYS);
    setError(null);
    setConfirmingRevoke(null);
    setCopied(null);
    setCreated(null);
    if (targetRef.current) void load(targetRef.current);
  }, [key, load]);

  // Copying runs on the reader's own click, never after a network wait: a
  // clipboard write that has outlived its click is refused by some browsers.
  const copy = async (link: ShareLink) => {
    if (await writeLinkToClipboard(link.path)) {
      setCopied(link.id);
    } else {
      setError({ code: "COPY_FAILED", message: "The browser blocked the clipboard. Select the link above and copy it instead." });
    }
  };

  const active = links?.filter((link) => link.active) ?? [];
  const inactive = links?.filter((link) => !link.active) ?? [];

  return (
    <Dialog.Root open={target !== null} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className={dialogBackdropClasses()} />
        <Dialog.Popup className={dialogPopupClasses("max-h-[85vh] w-[min(36rem,92vw)] overflow-y-auto")}>
          <Dialog.Title className="text-title font-semibold">{isFolder ? (folderName ? `Share folder ${folderName}` : "Share folder") : "Share link"}</Dialog.Title>
          <Dialog.Description className="mt-1 text-body text-kh-text-muted">
            {isFolder
              ? "Anyone with this link can read every document in this folder and its subfolders without signing in, including any you add later. They will see every change you make from now on, but they cannot edit anything or see anything else in My Space. Share only what you are happy to see forwarded."
              : "Anyone with this link can read this document without signing in. They will see every change you make from now on, but they cannot edit it or see anything else in My Space. Share only what you are happy to see forwarded."}
            {reviewCapability.read && <> Anyone with a valid link can read existing comments.{reviewCapability.write ? " Signing in is required to add comments and replies." : " Adding comments is currently disabled."}</>}
          </Dialog.Description>

          <form
            className="mt-5 flex flex-wrap items-end gap-3"
            onSubmit={async (event) => {
              event.preventDefault();
              const id = key;
              if (!target || busy) return;
              setBusy(true);
              setError(null);
              try {
                const { link } = await governanceRequest<{ link: ShareLink }>(linksUrl(target), "POST", {
                  label: label.trim() === "" ? undefined : label,
                  expiresInDays,
                });
                announceShareLinksChanged();
                if (current.current !== id) return;
                setLabel("");
                setLinks((existing) => [link, ...(existing ?? [])]);
                setCreated(link.id);
              } catch (failure) {
                if (current.current === id) setError(governanceFailure(failure));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Label className="min-w-0 flex-1">
              Label <span className="text-kh-text-muted">(optional)</span>
              <Input className="mt-1" value={label} maxLength={200} disabled={busy} placeholder="For the backend team" onChange={(event) => setLabel(event.target.value)} />
            </Label>
            <Label>
              Expires after
              <SelectMenu
                className="mt-1 flex w-full"
                value={expiresInDays}
                disabled={busy}
                onValueChange={setExpiresInDays}
                options={EXPIRY_OPTIONS.map((option) => ({ value: option.days, label: option.label }))}
              />
            </Label>
            <Button type="submit" disabled={busy || !target}>{busy ? "Creating…" : "Create link"}</Button>
          </form>
          <div className="mt-3"><GovernanceError error={error} /></div>

          {viaFolders.length > 0 ? (
            // A reminder, not a gate: nothing here asks for confirmation or stops the link below.
            <ul aria-label="Also shared through folders" className="mt-3 space-y-1">
              {viaFolders.map((folder) => (
                <li key={folder.folderNodeId} className="text-body-sm text-kh-text-muted">
                  Also visible through the shared folder{" "}
                  <button type="button" disabled={busy} onClick={() => onRetarget?.({ folderNodeId: folder.folderNodeId, name: folder.name })} className="rounded-sm font-medium text-kh-text underline kh-focus-ring">{folder.name}</button>
                </li>
              ))}
            </ul>
          ) : null}

          <section aria-label="Active links" className="mt-5">
            {links === null ? (
              <ShareLinksSkeleton />
            ) : active.length === 0 ? (
              <p className="text-body-sm text-kh-text-muted">No active links.</p>
            ) : (
              <ul className="divide-y divide-kh-border rounded-md border border-kh-border">
                {active.map((link) => (
                  <li key={link.id} className="space-y-2 px-3 py-2" data-share-link={link.path}>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body text-kh-text">
                          {link.label ?? "Untitled link"}
                          {created === link.id ? <span className="ml-2 text-caption text-kh-text-muted">Created</span> : null}
                        </p>
                        <p className="text-caption text-kh-text-muted">
                          Expires <Timestamp value={link.expiresAt} variant="date" /> · {link.totalViews} {link.totalViews === 1 ? "view" : "views"}
                        </p>
                      </div>
                      <Button variant={created === link.id ? "primary" : "secondary"} size="sm" type="button" onClick={() => void copy(link)}>
                        {copied === link.id ? "Copied" : "Copy link"}
                      </Button>
                      {confirmingRevoke === link.id ? (
                        <span className="flex items-center gap-1">
                          <Button
                            variant="danger"
                            size="sm"
                            type="button"
                            onClick={async () => {
                              const revoking = target;
                              setError(null);
                              try {
                                await governanceRequest<null>(`/api/share-links/${link.id}/revoke`, "POST");
                                announceShareLinksChanged();
                                setConfirmingRevoke(null);
                                if (revoking) await load(revoking);
                                toast({ message: `Link revoked. Anyone holding it can no longer open the ${isFolder ? "folder" : "document"}.` });
                              } catch (failure) {
                                setError(governanceFailure(failure));
                              }
                            }}
                          >
                            Confirm revoke
                          </Button>
                          <Button variant="ghost" size="sm" type="button" onClick={() => setConfirmingRevoke(null)}>Keep</Button>
                        </span>
                      ) : (
                        <Button variant="ghost" size="sm" type="button" onClick={() => setConfirmingRevoke(link.id)}>Revoke</Button>
                      )}
                    </div>
                    {/* Spec §4 shows the full link, which also leaves a way to
                        copy it by hand when the clipboard is refused. */}
                    <Input
                      size="sm"
                      readOnly
                      aria-label={`Link for ${link.label ?? "untitled link"}`}
                      value={`${origin}${link.path}`}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {inactive.length > 0 ? (
            <details className="mt-4">
              <summary className="cursor-pointer rounded-md text-body-sm text-kh-text-muted kh-focus-ring">Expired or revoked ({inactive.length})</summary>
              <ul className="mt-2 space-y-1">
                {inactive.map((link) => (
                  <li key={link.id} className="text-caption text-kh-text-muted">
                    {link.label ?? "Untitled link"} · {link.revokedAt ? "Revoked" : "Expired"} · {link.totalViews} {link.totalViews === 1 ? "view" : "views"}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <div className="mt-6 flex justify-end">
            <Button variant="secondary" type="button" disabled={busy} onClick={() => onOpenChange(false)}>Done</Button>
          </div>
          <DialogCloseButton disabled={busy} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
