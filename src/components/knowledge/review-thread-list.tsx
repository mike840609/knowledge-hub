"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { OwnerReviewThreadView, ReviewThreadView } from "@/modules/knowledge/domain/document-review";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Timestamp } from "@/components/ui/timestamp";
import { Textarea } from "@/components/ui/textarea";
import { Check, ChevronDown, MoreHorizontal } from "lucide-react";
import { MenuRoot, MenuTrigger, MenuContent, MenuItem } from "@/components/ui/menu";
import { buttonClasses } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { compareReviewPassages, useReviewRailLayout } from "./review-rail-layout";

export async function reviewRequest<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", referrerPolicy: "origin", redirect: "error", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Discussion service returned an unexpected response. Refresh and try again.");
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(response.status === 401 ? "Sign in to add a comment. Company sign-in is currently unavailable here." : response.status === 503 ? "Discussions are unavailable. You can still read the document." : response.status === 404 ? "This discussion or share link is no longer available." : result.error?.message ?? result.message ?? "The discussion could not be updated.");
    throw error;
  }
  return result as T;
}

/** A failed submission retains its UUID so a retry after a lost response writes once. */
export function ReviewReplyForm({ onSubmit, label = "Reply", openRequest = 0 }: { onSubmit: (body: string, key: string) => Promise<void>; label?: string; /** Changes when the card's own Reply was pressed: open the form. */ openRequest?: number }) {
  const [body, setBody] = useState("");
  const [expanded, setExpanded] = useState(label !== "Reply");
  useEffect(() => { if (openRequest > 0) setExpanded(true); }, [openRequest]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef<{ body: string; key: string } | null>(null);
  if (!expanded) return <Button type="button" variant="ghost" className="mt-3" onClick={() => setExpanded(true)}>Reply</Button>;
  return <form className="mt-3 space-y-2" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); } }} onSubmit={async event => {
    event.preventDefault(); if (busy || !body.trim()) return;
    if (!request.current || request.current.body !== body) request.current = { body, key: crypto.randomUUID() };
    setBusy(true); setError(undefined);
    try { await onSubmit(body, request.current.key); setBody(""); request.current = null; if (label === "Reply") setExpanded(false); } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save comment."); } finally { setBusy(false); }
  }}>
    <Textarea aria-label={label} placeholder={label === "Reply" ? "Reply…" : "Add a comment…"} rows={2} autoFocus className="!min-h-20 resize-y" value={body} disabled={busy} onChange={event => setBody(event.target.value)} required maxLength={6000} />
    {[...body].length >= 2700 && <p className="text-caption text-kh-text-muted">{[...body].length}/3,000</p>}
    {error && <p role="alert" className="text-body-sm">{error}</p>}
    <div className="flex justify-end gap-1">{label === "Reply" && <Button type="button" variant="ghost" disabled={busy} onClick={() => setExpanded(false)}>Cancel</Button>}<Button type="submit" disabled={busy || !body.trim() || [...body].length > 3000}>{busy ? "Saving…" : label}</Button></div>
  </form>;
}

export type ReviewFilter = "ALL" | "OPEN" | "RESOLVED";
const FILTER_NAMES: Record<ReviewFilter, string> = { ALL: "All comments", OPEN: "Open", RESOLVED: "Resolved" };

/** Which discussions are listed. The list draws it above itself unless a panel takes it for its heading. */
export function ReviewFilterMenu({ value, onChange }: { value: ReviewFilter; onChange: (value: ReviewFilter) => void }) {
  return <MenuRoot><MenuTrigger className={buttonClasses({ variant: "ghost" })} aria-label="Filter discussions">{FILTER_NAMES[value]}<ChevronDown className="size-4" aria-hidden="true" /></MenuTrigger><MenuContent>{(Object.keys(FILTER_NAMES) as ReviewFilter[]).map(option => <MenuItem key={option} onClick={() => onChange(option)}>{FILTER_NAMES[option]}</MenuItem>)}</MenuContent></MenuRoot>;
}

export function ReviewThreadList({ threads, writesEnabled, reply, moderate, canResolve = true, focusAnchor, railMarkdown, activeThreadId, onActivate, filter: controlled, onFilterChange }: {
  threads: (ReviewThreadView | OwnerReviewThreadView)[];
  writesEnabled: boolean;
  reply: (threadId: string, body: string, key: string) => Promise<void>;
  focusAnchor?: (anchor: NonNullable<ReviewThreadView["currentAnchor"]["anchor"]>) => void;
  canResolve?: boolean;
  moderate?: (threadId: string, action: "resolution" | "visibility", value: string, commentId?: string) => Promise<void>;
  railMarkdown?: string;
  activeThreadId?: string;
  onActivate?: (threadId: string) => void;
  /** Given both, the filter is the caller's — state and control — and the list draws none of its own. */
  filter?: ReviewFilter;
  onFilterChange?: (filter: ReviewFilter) => void;
}) {
  const [pendingHide, setPendingHide] = useState<{ threadId: string; commentId?: string }>();
  const [own, setOwn] = useState<ReviewFilter>("ALL");
  const filter = controlled ?? own;
  const setFilter = onFilterChange ?? setOwn;
  // A mark or a highlight may lead to a discussion the filter is hiding.
  useEffect(() => { const show = () => setFilter("ALL"); document.addEventListener("review-focus-thread",show); return () => document.removeEventListener("review-focus-thread",show); }, [setFilter]);
  // The card whose own Reply was pressed, and a count so that pressing it again asks again.
  const [replyRequest, setReplyRequest] = useState<{ threadId: string; nonce: number }>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function act(threadId: string, action: "resolution" | "visibility", value: string, commentId?: string, confirmed = false) {
    if (action === "visibility" && value === "HIDDEN" && !confirmed) { setPendingHide({ threadId, commentId }); return; }
    setBusy(true); setError(undefined);
    try { await moderate?.(threadId, action, value, commentId); } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not update discussion."); } finally { setBusy(false); setPendingHide(undefined); }
  }
  const visible = useMemo(() => {
    const filtered = threads.filter(thread => filter === "ALL" || thread.status === filter);
    return railMarkdown === undefined ? filtered : filtered.sort(compareReviewPassages);
  }, [threads, filter, railMarkdown]);
  const { ref: railRef, layout } = useReviewRailLayout(visible, railMarkdown, activeThreadId);
  return <div className="space-y-3">
    <ConfirmDialog open={!!pendingHide} onOpenChange={open => { if (!open) setPendingHide(undefined); }} title="Hide from reviewers?" description="This content will be hidden from all reviewers. It remains available to you for moderation." confirmLabel="Confirm hide" onConfirm={() => { if(pendingHide) void act(pendingHide.threadId,"visibility","HIDDEN",pendingHide.commentId,true); }} />
    {threads.length > 0 && !onFilterChange && <ReviewFilterMenu value={filter} onChange={setFilter} />}
    {error && <p role="alert" className="text-body-sm">{error}</p>}
    {visible.length === 0 && <p className="py-6 text-body-sm text-kh-text-muted">{threads.length === 0 ? "No comments yet." : "No comments here."}</p>}
    <div ref={railRef} data-review-rail={railMarkdown !== undefined ? "" : undefined} data-positioned={layout ? "" : undefined} className="kh-review-thread-list" style={layout ? { "--review-list-height": `${layout.height}px` } as CSSProperties : undefined}>
    {visible.map(thread => {
      const owner = "visibility" in thread ? thread : undefined;
      const active = activeThreadId === thread.id;
      const compact = !!onActivate && !active;
      const canReply = thread.status === "OPEN" && owner?.visibility !== "HIDDEN" && writesEnabled;
      return <section key={thread.id} data-review-thread={thread.id} data-active={active ? "" : undefined} tabIndex={-1} aria-label="Discussion thread" aria-current={active ? "true" : undefined} onFocus={event => {
        // A pointer focuses on mousedown. Moving the card then would move the button
        // out from under mouseup and swallow its click. Keyboard focus can activate now.
        if (event.target.matches(":focus-visible") && (event.target === event.currentTarget || event.target.closest("blockquote"))) onActivate?.(thread.id);
      }} onClick={() => onActivate?.(thread.id)} style={layout ? { "--review-thread-top": `${layout.positions[thread.id] ?? 0}px` } as CSSProperties : undefined} className={`rounded-md border kh-focus-ring focus:border-kh-primary p-3 ${active ? "border-kh-primary bg-kh-bg-selected" : "border-kh-border bg-kh-bg"}`}>
        {(thread.status === "RESOLVED" || owner?.visibility === "HIDDEN" || thread.currentAnchor.match === "OUTDATED") && <p className="mb-2 text-caption text-kh-text-muted">{[thread.status === "RESOLVED" ? "Resolved" : "", owner?.visibility === "HIDDEN" ? "Hidden from reviewers" : "", thread.currentAnchor.match === "OUTDATED" ? "Passage outdated" : ""].filter(Boolean).join(" · ")}</p>}
        {thread.currentAnchor.anchor && <blockquote className="mb-3 border-l border-kh-border pl-3 text-body-sm text-kh-text-muted"><button type="button" disabled={!focusAnchor} className={`line-clamp-2 text-left kh-focus-ring hover:text-kh-text ${thread.currentAnchor.anchor.blockKind === "code" ? "whitespace-pre-wrap break-words font-mono" : ""}`} onClick={() => {
          const locate = () => focusAnchor?.(thread.currentAnchor.anchor!);
          const navigation = new CustomEvent("review-focus-passage", { cancelable: true, detail: locate });
          if (document.dispatchEvent(navigation)) requestAnimationFrame(() => requestAnimationFrame(locate));
        }}>{thread.currentAnchor.anchor.exact}</button></blockquote>}
        {owner && thread.currentAnchor.match === "OUTDATED" && <blockquote className="mb-3 border-l border-kh-border pl-3 text-body-sm text-kh-text-muted">Original passage (owner only): {owner.originalAnchor.exact}</blockquote>}
        <ol className="space-y-4">{(compact ? thread.comments.slice(0, 1) : thread.comments).map((comment, index) => <li key={comment.id} className="text-body-sm">
          <div className="mb-2 flex items-start gap-2">
            <span aria-hidden="true" className={`flex ${compact ? "size-6" : "size-8"} shrink-0 items-center justify-center rounded-full bg-kh-bg-selected font-medium text-kh-selected-text`}>{(comment.authorName ?? "C").slice(0, 1).toUpperCase()}</span>
            <div className="min-w-0 flex-1"><p className="truncate font-medium">{comment.authorName ?? "Company colleague"}{comment.visibility === "HIDDEN" ? " · Hidden" : ""}</p>{!compact && <p className="text-caption text-kh-text-muted"><Timestamp value={comment.createdAt} /></p>}</div>
            {moderate && index === 0 && <Tooltip label={thread.status === "OPEN" ? "Resolve" : "Reopen"}><Button type="button" variant="ghost" icon aria-label={thread.status === "OPEN" ? "Resolve" : "Reopen"} disabled={busy || !canResolve} onClick={() => void act(thread.id, "resolution", thread.status === "OPEN" ? "RESOLVED" : "OPEN")}><Check className="size-4" aria-hidden="true" /></Button></Tooltip>}
            {moderate && <MenuRoot><MenuTrigger aria-label={index === 0 ? "Comment options" : "Reply options"} className={buttonClasses({variant:"ghost",icon:true})}><MoreHorizontal className="size-4" aria-hidden="true" /></MenuTrigger><MenuContent align="end"><MenuItem disabled={busy} onClick={() => void act(thread.id, "visibility", index === 0 ? (owner?.visibility === "HIDDEN" ? "VISIBLE" : "HIDDEN") : (comment.visibility === "HIDDEN" ? "VISIBLE" : "HIDDEN"), index === 0 ? undefined : comment.id)}>{index === 0 ? (owner?.visibility === "HIDDEN" ? "Unhide thread" : "Hide thread") : comment.visibility === "HIDDEN" ? "Unhide reply" : "Hide reply"}</MenuItem></MenuContent></MenuRoot>}
          </div>
          <p className={`whitespace-pre-wrap break-words ${compact ? "line-clamp-2" : ""}`}>{comment.body}</p>
        </li>)}</ol>
        {/* A preview's one button. With replies to show, it shows them. With only the remark — which
            the preview already is — opening the card would reveal nothing but Reply, so it is Reply:
            one step from reading to answering, and focus lands in the form. Where no reply can be
            made it opens the card, for the full text and its time. */}
        {compact && (thread.comments.length === 1 && canReply
          ? <Button type="button" variant="ghost" className="mt-2" onClick={() => { onActivate?.(thread.id); setReplyRequest(previous => ({ threadId: thread.id, nonce: (previous?.nonce ?? 0) + 1 })); }}>Reply</Button>
          : <Button type="button" variant="ghost" className="mt-2" onClick={event => { event.currentTarget.closest<HTMLElement>("[data-review-thread]")?.focus({ preventScroll: true }); onActivate?.(thread.id); }}>{thread.comments.length > 1 ? `Show ${thread.comments.length - 1} ${thread.comments.length === 2 ? "reply" : "replies"}` : "Expand comment"}</Button>)}
        {canReply && <div hidden={compact}><ReviewReplyForm openRequest={replyRequest?.threadId === thread.id ? replyRequest.nonce : 0} onSubmit={(body, key) => reply(thread.id, body, key)} /></div>}
      </section>;
    })}
    </div>
  </div>;
}
