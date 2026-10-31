"use client";
import { Illustration } from "@/components/knowledge/illustration";


import { Share2 } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { WorkspaceContentActions } from "./workspace-content-actions";
import { useEffect, useRef, useState } from "react";
import { reviewRequest } from "./review-thread-list";
import Link from "next/link";
import { Copy, MoreHorizontal, Search } from "lucide-react";
import { MenuRoot, MenuTrigger, MenuContent, MenuItem } from "@/components/ui/menu";
import { buttonClasses } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { applyAndSearch, LiveSearch } from "@/components/search/live-search-submit";
import { Timestamp } from "@/components/ui/timestamp";
import { Status } from "@/components/ui/status";
import { useToast } from "@/components/ui/toast";
import { GovernanceError, governanceFailure, governanceRequest, type GovernanceFailure } from "@/components/workspaces/governance-error";
import { writeLinkToClipboard } from "@/components/actions/action-menu";
import { navigateListRows } from "@/lib/list-row-navigation";
import type { ManagedShareLink, ShareManagementQuery, ShareManagementStatus } from "@/modules/knowledge/domain/share-management";
const labels: Record<ShareManagementStatus, string> = { active: "Active", expired: "Expired", revoked: "Revoked", unavailable: "Unavailable" };
type UnreadShareCount = { documentId: string; unreadCount: number; latestThreadId: string };
export type ShareManagementModel = { query: ShareManagementQuery; items: ManagedShareLink[]; hasNext: boolean };
export function ShareManagementView({ workspaceId, model, filterError, hasDocuments = true }: { workspaceId: string; model: ShareManagementModel; filterError?: string; hasDocuments?: boolean }) {
  const router = useRouter(), toast = useToast();
  const [origin, setOrigin] = useState("");
  const [status, setStatus] = useState<string>(model.query.status);
  const [query, setQuery] = useState<string>(model.query.q);
  const filterForm = useRef<HTMLFormElement>(null);
  useEffect(() => setStatus(model.query.status), [model.query.status]);
  useEffect(() => setQuery(model.query.q), [model.query.q]);
  const [unreadCounts, setUnreadCounts] = useState<UnreadShareCount[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [revoked, setRevoked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<GovernanceFailure | null>(null);
  const [details, setDetails] = useState<string | null>(null);
  const [manualCopy, setManualCopy] = useState<{ id: string } | null>(null);
  const fields = useRef(new Map<string, HTMLDivElement>());
  const pending = useRef(false);
  useEffect(() => { setOrigin(window.location.origin); }, []);
  // Refresh on entry and after reading a discussion. Fetch only aggregated counts,
  // not the truncated/full-body notification preview used by the global Inbox.
  useEffect(() => {
    let mounted = true;
    const refreshCounts = async () => {
      try {
        const result = await reviewRequest<{ counts: UnreadShareCount[] }>("/api/review-notifications/share-counts");
        if (mounted) setUnreadCounts(result.counts);
      } catch {
        // Shares remains usable if notification counts are temporarily unavailable.
        if (mounted) setUnreadCounts([]);
      }
    };
    void refreshCounts();
    window.addEventListener("focus", refreshCounts);
    window.addEventListener("kh:notification-changed", refreshCounts);
    return () => {
      mounted = false;
      window.removeEventListener("focus", refreshCounts);
      window.removeEventListener("kh:notification-changed", refreshCounts);
    };
  }, [workspaceId]);
  useEffect(() => {
    if (!manualCopy) return;
    const field = fields.current.get(manualCopy.id)?.querySelector("input");
    field?.focus(); field?.select();
  }, [manualCopy]);
  // Multiple share links can point to one document. Show a single badge per
  // document in the current page, rather than repeating the unread count per link.
  const firstLinkByDocument = new Map<string, string>();
  for (const item of model.items) {
    if (!firstLinkByDocument.has(item.documentId)) firstLinkByDocument.set(item.documentId, item.id);
  }
  const unreadByDocument = new Map(unreadCounts.map(count => [count.documentId, count]));
  const confirmedItem = model.items.find(item => item.id === confirming);
  const filtered = !!model.query.q || model.query.status !== "all" || model.query.page > 1;
  const href = (page: number) => `/w/${workspaceId}/shares?${new URLSearchParams({ q: model.query.q, status: model.query.status, page: String(page) })}`;
  async function revoke(id: string) {
    if (pending.current) return;
    pending.current = true; setBusy(id); setError(null);
    try {
      await governanceRequest<null>(`/api/share-links/${id}/revoke`, "POST");
      setRevoked(current => new Set([...current, id])); setConfirming(null);
      toast({ message: "Link revoked. Anyone holding it can no longer open the document." }); router.refresh();
    } catch (failure) { setError(governanceFailure(failure)); }
    finally { pending.current = false; setBusy(null); }
  }
  async function copy(item: ManagedShareLink) {
    if (await writeLinkToClipboard(item.path)) { toast({ message: "Link copied." }); setError(null); }
    else { setDetails(item.id); setManualCopy({ id: item.id }); setError({ code: "COPY_FAILED", message: "Clipboard unavailable. The link is selected; copy it manually." }); }
  }
  return <>
    <div className="mt-3 flex flex-wrap items-center gap-2">
    <form ref={filterForm} action={`/w/${workspaceId}/shares`} method="get" className="flex min-w-0 flex-1 flex-wrap items-center gap-2" aria-label="Filter shares">
      <div className="relative basis-full sm:w-72 sm:flex-none">
        <label htmlFor="shares-query" className="sr-only">Find shares</label>
        <Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-kh-text-muted" />
        <Input id="shares-query" name="q" value={query} onChange={event => setQuery(event.target.value)} maxLength={200} placeholder="Find shares…" className="kh-search-field" />
      </div>
      <label htmlFor="shares-status" className="sr-only">Status</label>
      <SelectMenu id="shares-status" name="status" value={status} onValueChange={(value) => applyAndSearch(filterForm.current, () => setStatus(value))} options={[{ value: "all", label: "All statuses" }, ...Object.entries(labels).map(([value, label]) => ({ value, label }))]} />
      <LiveSearch />
      {model.query.q || model.query.status !== "active" || model.query.page > 1 ? <Link className="kh-focus-ring rounded-md text-body-sm text-kh-link" href={`/w/${workspaceId}/shares`}>Clear filters</Link> : null}
    </form>
    {model.items.length > 0 ? <p role="status" className="ml-auto text-caption text-kh-text-muted">{model.items.length} {model.items.length === 1 ? "share" : "shares"}{model.query.page > 1 || model.hasNext ? " on this page" : ""}</p> : null}
    </div>
    {filterError ? <p role="alert" className="mt-3 text-body text-kh-danger">{filterError}</p> : null}
    <GovernanceError error={error} />
    {!filterError && model.items.length === 0 ? <EmptyState icon={Share2} illustration={!model.query.q && model.query.page === 1 && (model.query.status === "all" || (model.query.status === "active" && !hasDocuments)) ? <Illustration kind="shares" /> : undefined} title={!model.query.q && model.query.page === 1 && model.query.status === "active" ? "No active share links." : filtered ? "No shares match these filters." : "No share links yet."} description={filtered && (model.query.q || model.query.page > 1 || model.query.status !== "active") ? "Clear the filters to see links with other titles or statuses." : hasDocuments ? "Open a document and choose Share to create a link." : "Links you share to your documents appear here."} action={filtered && (model.query.q || model.query.page > 1 || model.query.status !== "active") ? <Link className={buttonClasses({ variant: "secondary" })} href={`/w/${workspaceId}/shares?status=all`}>Show all shares</Link> : hasDocuments ? <Link className={buttonClasses({ variant: "secondary" })} href={`/w/${workspaceId}/knowledge`}>Browse documents</Link> : <WorkspaceContentActions workspaceId={workspaceId} />} /> : null}
    {model.items.length > 0 ? <div aria-hidden="true" className="mt-4 hidden grid-cols-[minmax(0,1fr)_6rem_7rem_4rem_6rem] items-center gap-3 border-b border-kh-border px-3 py-2 text-caption text-kh-text-muted md:grid"><span>Document / link</span><span>Status</span><span>Expires</span><span className="text-right">Views</span><span /></div> : null}
    <ul aria-label="Share links" onKeyDown={navigateListRows} className="mt-4 space-y-2 md:mt-0 md:space-y-0">
      {model.items.map(item => {
        const status = revoked.has(item.id) ? "revoked" : item.status;
        const actionLabel = `Share actions for ${item.title} · ${item.label ?? "Untitled link"}`;
        const notice = firstLinkByDocument.get(item.documentId) === item.id ? unreadByDocument.get(item.documentId) : undefined;
        return <li key={item.id} className="group rounded-md border border-kh-border bg-kh-bg p-3 hover:bg-kh-bg-hover focus-within:bg-kh-bg-hover md:rounded-none md:border-x-0 md:border-t-0 md:py-0.5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 md:grid-cols-[minmax(0,1fr)_6rem_7rem_4rem_6rem] md:gap-y-0">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <Link data-list-row className="kh-focus-ring min-w-0 flex-1 truncate rounded-md text-body font-medium text-kh-text hover:text-kh-link" href={`/w/${workspaceId}/knowledge/${item.sourceId}/${item.documentId}?includeArchived=true`}>{item.title}</Link>
                {notice ? <Link
                  href={`/w/${workspaceId}/knowledge/${item.sourceId}/${item.documentId}?thread=${notice.latestThreadId}`}
                  aria-label={`Open ${notice.unreadCount} unread comments for ${item.title}`}
                  className="kh-focus-ring shrink-0 rounded-full bg-kh-bg-selected px-2 py-0.5 text-caption font-semibold text-kh-selected-text hover:bg-kh-highlight"
                >{notice.unreadCount} new</Link> : null}
              </div>
              <p className="truncate text-caption text-kh-text-muted" title={`${item.sourceName} · ${item.label ?? "Untitled link"}`}>{item.sourceName} · {item.label ?? "Untitled link"}</p>
            </div>
            <span className="row-start-2 text-caption text-kh-text-muted md:row-auto"><Status kind={status === "active" ? "active" : "none"}>{labels[status]}</Status></span>
            <span className="col-span-2 text-caption text-kh-text-muted md:col-span-1"><span className="md:sr-only">Expires </span><Timestamp value={item.expiresAt} variant="date" /></span>
            <span className="col-start-2 row-start-2 whitespace-nowrap text-right text-caption tabular-nums text-kh-text-muted md:col-auto md:row-auto">{item.totalViews.toLocaleString()}<span className="md:sr-only"> {item.totalViews === 1 ? "view" : "views"}</span></span>
            <div className="col-start-2 row-start-1 flex items-center gap-1 justify-self-end md:col-auto md:row-auto">
              {status === "active" ? <Button variant="ghost" size="sm" icon className="kh-row-action" aria-label={`Copy link for ${item.title} · ${item.label ?? "Untitled link"}`} disabled={busy !== null} onClick={() => void copy(item)}><Copy size={15} aria-hidden="true" /></Button> : null}
              <MenuRoot>
                <MenuTrigger aria-label={actionLabel} disabled={busy !== null} className={buttonClasses({ variant: "ghost", icon: true, size: "sm", className: "kh-row-action" })}><MoreHorizontal size={15} aria-hidden="true" /></MenuTrigger>
                <MenuContent align="end" className="min-w-40">
                  {status === "active" ? <MenuItem onClick={() => void copy(item)}>Copy link</MenuItem> : null}
                  <MenuItem onClick={() => { setManualCopy(null); setDetails(current => current === item.id ? null : item.id); }}>{details === item.id ? "Hide details" : "Show details"}</MenuItem>
                  {status !== "revoked" ? <MenuItem onClick={() => setConfirming(item.id)}>Revoke</MenuItem> : null}
                </MenuContent>
              </MenuRoot>
            </div>
          </div>
          {details === item.id ? <div className="mt-3 space-y-2 border-t border-kh-border pt-3">
            <p className="break-words text-caption text-kh-text-muted">{item.sourceName} · {item.label ?? "Untitled link"}</p>
            <p className="text-caption text-kh-text-muted">Created <Timestamp value={item.createdAt} /> · Expires <Timestamp value={item.expiresAt} />{item.lastViewedAt ? <> · Last viewed <Timestamp value={item.lastViewedAt} /></> : " · Not viewed yet"}</p>
            {status === "unavailable" ? <p className="text-caption text-kh-text-muted">Sharing is paused. Restoring the document or its source may reactivate this link until expiry. Revoke it to end sharing permanently.</p> : null}
            {status === "active" ? <div ref={field => { if (field) fields.current.set(item.id, field); else fields.current.delete(item.id); }}><Input readOnly size="sm" aria-label={`Share URL for ${item.title} · ${item.label ?? "Untitled link"}`} value={`${origin}${item.path}`} onFocus={event => event.currentTarget.select()} /></div> : null}
          </div> : null}

        </li>;
      })}
    </ul>
    <ConfirmDialog open={!!confirmedItem} onOpenChange={open => { if (!open) setConfirming(null); }} title="Revoke share link?" description={<>Revoke “{confirmedItem?.label ?? "Untitled link"}” for {confirmedItem?.title}? Anyone holding this link will lose access. This cannot be undone.</>} cancelLabel="Keep" confirmLabel="Confirm revoke" onConfirm={() => { if (confirming) void revoke(confirming); }} />
    {model.query.page > 1 || model.hasNext ? <nav aria-label="Share pages" className="mt-4 flex items-center gap-4 text-body"><span className="text-kh-text-muted">Page {model.query.page}</span>{model.query.page > 1 ? <Link className="kh-focus-ring rounded-md text-kh-link" href={href(model.query.page - 1)}>Previous</Link> : null}{model.hasNext ? <Link className="kh-focus-ring rounded-md text-kh-link" href={href(model.query.page + 1)}>Next</Link> : null}</nav> : null}
  </>;
}
