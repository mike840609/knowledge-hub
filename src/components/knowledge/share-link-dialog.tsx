"use client";

import { useCallback, useEffect, useState } from "react";
import { Dialog } from "@base-ui-components/react/dialog";
import { SHARE_REQUEST_EVENT } from "@/components/actions/action-menu";
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

/** The API returns a path; the reader's own origin makes it a link (share-link spec §9.4). */
function absoluteUrl(path: string): string {
  return `${window.location.origin}${path}`;
}

/**
 * Mounted once by the knowledge layout. Any surface — row menu, palette,
 * document header — opens it by dispatching SHARE_REQUEST_EVENT, the same
 * way they ask for the details panel.
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
  const [expiresInDays, setExpiresInDays] = useState<number>(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GovernanceFailure | null>(null);
  const [confirmingRevoke, setConfirmingRevoke] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    try {
      const result = await governanceRequest<{ links: ShareLink[] }>(`/api/documents/${id}/share-links`);
      setLinks(result.links);
    } catch (failure) {
      setError(governanceFailure(failure));
    }
  }, []);

  useEffect(() => {
    setLinks(null);
    setLabel("");
    setExpiresInDays(30);
    setError(null);
    setConfirmingRevoke(null);
    setCopied(null);
    if (documentId) void load(documentId);
  }, [documentId, load]);

  const copy = async (link: ShareLink) => {
    try {
      await navigator.clipboard.writeText(absoluteUrl(link.path));
      setCopied(link.id);
    } catch {
      setError({ code: "COPY_FAILED", message: "Copying was blocked by the browser. Select the link and copy it instead." });
    }
  };

  const active = links?.filter((link) => link.active) ?? [];
  const inactive = links?.filter((link) => !link.active) ?? [];

  return (
    <Dialog.Root open={documentId !== null} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-kh-overlay transition-opacity duration-120 ease-out data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(36rem,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-kh-border bg-kh-bg p-6 shadow-modal outline-none transition-[opacity,transform] duration-120 ease-out data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0">
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
              if (!documentId || busy) return;
              setBusy(true);
              setError(null);
              try {
                const { link } = await governanceRequest<{ link: ShareLink }>(`/api/documents/${documentId}/share-links`, "POST", {
                  label: label.trim() === "" ? undefined : label,
                  expiresInDays,
                });
                setLabel("");
                setLinks((current) => [link, ...(current ?? [])]);
                await copy(link);
              } catch (failure) {
                setError(governanceFailure(failure));
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
                  <li key={link.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2" data-share-link={link.path}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body text-kh-text">{link.label ?? "Untitled link"}</p>
                      <p className="text-caption text-kh-text-muted">
                        Expires <Timestamp value={link.expiresAt} variant="date" /> · {link.totalViews} {link.totalViews === 1 ? "view" : "views"}
                      </p>
                    </div>
                    <Button variant="secondary" size="sm" type="button" onClick={() => void copy(link)}>
                      {copied === link.id ? "Copied" : "Copy link"}
                    </Button>
                    {confirmingRevoke === link.id ? (
                      <span className="flex items-center gap-1">
                        <Button
                          variant="danger"
                          size="sm"
                          type="button"
                          onClick={async () => {
                            setError(null);
                            try {
                              await governanceRequest<null>(`/api/share-links/${link.id}/revoke`, "POST");
                              setConfirmingRevoke(null);
                              if (documentId) await load(documentId);
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
                  </li>
                ))}
              </ul>
            )}
          </section>

          {inactive.length > 0 ? (
            <details className="mt-4">
              <summary className="cursor-pointer text-body-sm text-kh-text-muted">Expired or revoked ({inactive.length})</summary>
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
