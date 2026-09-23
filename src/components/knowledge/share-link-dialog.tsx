"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "@base-ui-components/react/dialog";
import { SHARE_REQUEST_EVENT, writeLinkToClipboard } from "@/components/actions/action-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Timestamp } from "@/components/ui/timestamp";
import { useToast } from "@/components/ui/toast";
import {
  GovernanceError,
  governanceFailure,
  governanceRequest,
  type GovernanceFailure,
} from "@/components/workspaces/governance-error";

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

/**
 * Mounted once by the knowledge layout. Any surface — row menu, palette,
 * document header — opens it through requestShare(), the same way they ask
 * for the details panel.
 */
export function ShareLinkDialogHost() {
  const [documentId, setDocumentId] = useState<string | null>(null);
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<{ documentId?: unknown }>).detail;
      if (typeof detail?.documentId === "string") setDocumentId(detail.documentId);
    };
    window.addEventListener(SHARE_REQUEST_EVENT, open);
    return () => window.removeEventListener(SHARE_REQUEST_EVENT, open);
  }, []);
  return (
    <ShareLinkDialog
      documentId={documentId}
      onOpenChange={(next) => {
        if (!next) setDocumentId(null);
      }}
    />
  );
}

export function ShareLinkDialog({
  documentId,
  onOpenChange,
}: {
  documentId: string | null;
  onOpenChange: (open: boolean) => void;
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
  const [origin, setOrigin] = useState("");
  // The document the dialog is open for right now. A response for any other
  // document — the dialog was closed and reopened elsewhere before it
  // arrived — is dropped rather than shown with this one's buttons.
  const current = useRef<string | null>(documentId);
  current.current = documentId;

  const load = useCallback(async (id: string) => {
    try {
      const result = await governanceRequest<{ links: ShareLink[] }>(`/api/documents/${id}/share-links`);
      if (current.current === id) setLinks(result.links);
    } catch (failure) {
      if (current.current === id) setError(governanceFailure(failure));
    }
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
    setLinks(null);
    setLabel("");
    setExpiresInDays(DEFAULT_EXPIRY_DAYS);
    setError(null);
    setConfirmingRevoke(null);
    setCopied(null);
    setCreated(null);
    if (documentId) void load(documentId);
  }, [documentId, load]);

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
    <Dialog.Root open={documentId !== null} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-kh-overlay transition-opacity duration-120 ease-out data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(36rem,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-kh-border bg-kh-bg p-6 shadow-modal outline-none transition-[opacity,transform] duration-120 ease-out data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0">
          <Dialog.Title className="text-title font-semibold">Share link</Dialog.Title>
          <Dialog.Description className="mt-1 text-body text-kh-text-muted">
            Anyone with this link can read this document without signing in. They will see every change you make
            from now on, but they cannot edit it or see anything else in My Space. Share only what you are happy to
            see forwarded.
          </Dialog.Description>

          <form
            className="mt-5 flex flex-wrap items-end gap-3"
            onSubmit={async (event) => {
              event.preventDefault();
              const id = documentId;
              if (!id || busy) return;
              setBusy(true);
              setError(null);
              try {
                const { link } = await governanceRequest<{ link: ShareLink }>(`/api/documents/${id}/share-links`, "POST", {
                  label: label.trim() === "" ? undefined : label,
                  expiresInDays,
                });
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
            <label className="block min-w-0 flex-1 text-body">
              Label <span className="text-kh-text-muted">(optional)</span>
              <Input className="mt-1" value={label} maxLength={200} disabled={busy} placeholder="For the backend team" onChange={(event) => setLabel(event.target.value)} />
            </label>
            <label className="block text-body">
              Expires after
              <Select className="mt-1 block" value={expiresInDays} disabled={busy} onChange={(event) => setExpiresInDays(Number(event.target.value))}>
                {EXPIRY_OPTIONS.map((option) => <option key={option.days} value={option.days}>{option.label}</option>)}
              </Select>
            </label>
            <Button type="submit" disabled={busy || !documentId}>{busy ? "Creating…" : "Create link"}</Button>
          </form>
          <div className="mt-3"><GovernanceError error={error} /></div>

          <section aria-label="Active links" className="mt-5">
            {links === null ? (
              <p className="text-body-sm text-kh-text-muted">Loading links…</p>
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
                              const id = documentId;
                              setError(null);
                              try {
                                await governanceRequest<null>(`/api/share-links/${link.id}/revoke`, "POST");
                                setConfirmingRevoke(null);
                                if (id) await load(id);
                                toast({ message: "Link revoked. Anyone holding it can no longer open the document." });
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
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
