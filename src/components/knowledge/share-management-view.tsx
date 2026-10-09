"use client";
import { WorkspaceEmptyIllustration } from "@/components/knowledge/workspace-empty-illustration";


import { Share2 } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { WorkspaceContentActions } from "./workspace-content-actions";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Copy, MoreHorizontal, Search, RefreshCw } from "lucide-react";
import { MenuRoot, MenuTrigger, MenuContent, MenuItem } from "@/components/ui/menu";
import { buttonClasses } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Timestamp } from "@/components/ui/timestamp";
import { useToast } from "@/components/ui/toast";
import { GovernanceError, governanceFailure, governanceRequest, type GovernanceFailure } from "@/components/workspaces/governance-error";
import { writeLinkToClipboard } from "@/components/actions/action-menu";
import { navigateListRows } from "@/lib/list-row-navigation";
import type { ManagedShareLink, ShareManagementQuery, ShareManagementStatus } from "@/modules/knowledge/domain/share-management";
const labels: Record<ShareManagementStatus, string> = { active: "Active", expired: "Expired", revoked: "Revoked", unavailable: "Unavailable" };
export type ShareManagementModel = { query: ShareManagementQuery; items: ManagedShareLink[]; hasNext: boolean };
export function ShareManagementView({ workspaceId, model, filterError, hasDocuments = true }: { workspaceId: string; model: ShareManagementModel; filterError?: string; hasDocuments?: boolean }) {
  const router = useRouter(), toast = useToast();
  const [origin, setOrigin] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [revoked, setRevoked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<GovernanceFailure | null>(null);
  const [details, setDetails] = useState<string | null>(null);
  const [manualCopy, setManualCopy] = useState<{ id: string } | null>(null);
  const fields = useRef(new Map<string, HTMLDivElement>());
  const pending = useRef(false);
  useEffect(() => { setOrigin(window.location.origin); }, []);
  useEffect(() => {
    if (!manualCopy) return;
    const field = fields.current.get(manualCopy.id)?.querySelector("input");
    field?.focus(); field?.select();
  }, [manualCopy]);
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
  return <main className="kh-page pb-6">
    <PageHeader location="My Space" locationHref={`/w/${workspaceId}/home`} title="Shares" description="Manage links to your documents. Anyone holding an active link can read its latest saved content without signing in." />
    <form action={`/w/${workspaceId}/shares`} method="get" className="mt-4 flex flex-wrap items-center gap-2" aria-label="Filter shares">
      <div className="relative min-w-0 basis-full sm:flex-1 sm:basis-auto">
        <label htmlFor="shares-query" className="sr-only">Find shares</label>
        <Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-kh-text-muted" />
        <Input id="shares-query" name="q" defaultValue={model.query.q} maxLength={200} placeholder="Find shares…" className="kh-search-field" />
      </div>
      <label htmlFor="shares-status" className="sr-only">Status</label>
      <Select id="shares-status" name="status" defaultValue={model.query.status}><option value="all">All statuses</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
      <Button type="submit" variant="secondary">Search</Button>
      <Button type="button" variant="ghost" icon aria-label="Refresh shares" disabled={busy !== null} onClick={() => router.refresh()}><RefreshCw size={15} aria-hidden="true" /></Button>
      {filtered ? <Link className="kh-focus-ring rounded-md text-body-sm text-kh-link" href={`/w/${workspaceId}/shares?status=all`}>Clear filters</Link> : null}
    </form>
    {filterError ? <p role="alert" className="mt-3 text-body text-kh-danger">{filterError}</p> : null}
    <GovernanceError error={error} />
    {!filterError && model.items.length === 0 ? <EmptyState icon={Share2} illustration={!model.query.q && model.query.page === 1 && (model.query.status === "all" || (model.query.status === "active" && !hasDocuments)) ? <WorkspaceEmptyIllustration kind="shares" /> : undefined} title={!model.query.q && model.query.page === 1 && model.query.status === "active" ? "No active share links." : filtered ? "No shares match these filters." : "No share links yet."} description={filtered && (model.query.q || model.query.page > 1 || model.query.status !== "active") ? "Clear the filters to see links with other titles or statuses." : hasDocuments ? "Open a document and use its Share action to create a link. Created links appear here, where you can check their status or revoke access." : "Add your first document, then use its Share action to create a link. You can manage and revoke your links here."} action={filtered && (model.query.q || model.query.page > 1 || model.query.status !== "active") ? <Link className={buttonClasses({ variant: "secondary" })} href={`/w/${workspaceId}/shares?status=all`}>Show all shares</Link> : hasDocuments ? <Link className={buttonClasses({ variant: "secondary" })} href={`/w/${workspaceId}/knowledge`}>Browse documents</Link> : <WorkspaceContentActions workspaceId={workspaceId} />} /> : null}
    {model.items.length > 0 ? <div aria-hidden="true" className="mt-4 hidden grid-cols-[minmax(0,1fr)_6rem_7rem_4rem_6rem] items-center gap-3 border-b border-kh-border px-3 py-2 text-caption text-kh-text-muted md:grid"><span>Document / link</span><span>Status</span><span>Expires</span><span className="text-right">Views</span><span /></div> : null}
    <ul aria-label="Share links" onKeyDown={navigateListRows} className="mt-4 space-y-2 md:mt-0 md:space-y-0">
      {model.items.map(item => {
        const status = revoked.has(item.id) ? "revoked" : item.status;
        const actionLabel = `Share actions for ${item.title} · ${item.label ?? "Untitled link"}`;
        return <li key={item.id} className="group rounded-md border border-kh-border bg-kh-bg p-3 hover:bg-kh-bg-hover focus-within:bg-kh-bg-hover md:rounded-none md:border-x-0 md:border-t-0 md:py-2">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 md:grid-cols-[minmax(0,1fr)_6rem_7rem_4rem_6rem] md:gap-y-0">
            <div className="min-w-0"><Link data-list-row className="kh-focus-ring block truncate rounded-md text-body font-medium text-kh-text hover:text-kh-link" href={`/w/${workspaceId}/knowledge/${item.sourceId}/${item.documentId}?includeArchived=true`}>{item.title}</Link><p className="truncate text-caption text-kh-text-muted" title={`${item.sourceName} · ${item.label ?? "Untitled link"}`}>{item.sourceName} · {item.label ?? "Untitled link"}</p></div>
            <span className="row-start-2 text-caption text-kh-text-muted md:row-auto"><span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${status === "active" ? "bg-kh-primary" : "bg-kh-text-muted"}`} />{labels[status]}</span></span>
            <span className="col-span-2 text-caption text-kh-text-muted md:col-span-1"><span className="md:sr-only">Expires </span><Timestamp value={item.expiresAt} variant="date" /></span>
            <span className="col-start-2 row-start-2 whitespace-nowrap text-right text-caption tabular-nums text-kh-text-muted md:col-auto md:row-auto">{item.totalViews.toLocaleString()}<span className="md:sr-only"> {item.totalViews === 1 ? "view" : "views"}</span></span>
            <div className="col-start-2 row-start-1 flex items-center gap-1 justify-self-end md:col-auto md:row-auto">
              {status === "active" ? <Button variant="ghost" size="sm" icon aria-label={`Copy link for ${item.title} · ${item.label ?? "Untitled link"}`} disabled={busy !== null} onClick={() => void copy(item)}><Copy size={15} aria-hidden="true" /></Button> : null}
              <MenuRoot>
                <MenuTrigger aria-label={actionLabel} disabled={busy !== null} className={buttonClasses({ variant: "ghost", icon: true, size: "sm", className: "kh-row-action" })}><MoreHorizontal size={15} aria-hidden="true" /></MenuTrigger>
                <MenuContent align="end" className="min-w-40">
                  {status === "active" ? <MenuItem onClick={() => void copy(item)}>Copy link</MenuItem> : null}
                  <MenuItem onClick={() => { setManualCopy(null); setDetails(current => current === item.id ? null : item.id); }}>{details === item.id ? "Hide details" : "Show details"}</MenuItem>
                  {status !== "revoked" ? <MenuItem className="text-kh-danger" onClick={() => setConfirming(item.id)}>Revoke</MenuItem> : null}
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
    <nav aria-label="Share pages" className="mt-4 flex items-center gap-4 text-body"><span className="text-kh-text-muted">Page {model.query.page}</span>{model.query.page > 1 ? <Link className="kh-focus-ring rounded-md text-kh-link" href={href(model.query.page - 1)}>Previous</Link> : null}{model.hasNext ? <Link className="kh-focus-ring rounded-md text-kh-link" href={href(model.query.page + 1)}>Next</Link> : null}</nav>
  </main>;
}
