"use client";

import { useEffect, useRef, useState } from "react";
import type { OwnerReviewThreadView, ReviewThreadView } from "@/modules/knowledge/domain/document-review";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Timestamp } from "@/components/ui/timestamp";
import { Textarea } from "@/components/ui/textarea";
import { Check, ChevronDown, MoreHorizontal } from "lucide-react";
import { MenuRoot, MenuTrigger, MenuContent, MenuItem } from "@/components/ui/menu";
import { buttonClasses } from "@/components/ui/button";
import { Button } from "@/components/ui/button";

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
export function ReviewReplyForm({ onSubmit, label = "Reply" }: { onSubmit: (body: string, key: string) => Promise<void>; label?: string }) {
  const [body, setBody] = useState("");
  const [expanded, setExpanded] = useState(label !== "Reply");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef<{ body: string; key: string } | null>(null);
  if (!expanded) return <Button type="button" variant="ghost" className="mt-3" onClick={() => setExpanded(true)}>Reply</Button>;
  return <form className="mt-3 space-y-2" onSubmit={async event => {
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

export function ReviewThreadList({ threads, writesEnabled, reply, moderate, canResolve = true, focusAnchor }: {
  threads: (ReviewThreadView | OwnerReviewThreadView)[];
  writesEnabled: boolean;
  reply: (threadId: string, body: string, key: string) => Promise<void>;
  focusAnchor?: (anchor: NonNullable<ReviewThreadView["currentAnchor"]["anchor"]>) => void;
  canResolve?: boolean;
  moderate?: (threadId: string, action: "resolution" | "visibility", value: string, commentId?: string) => Promise<void>;
}) {
  const [pendingHide, setPendingHide] = useState<{ threadId: string; commentId?: string }>();
  const [filter, setFilter] = useState<"ALL" | "OPEN" | "RESOLVED">("ALL");
  useEffect(() => { const show = () => setFilter("ALL"); document.addEventListener("review-focus-thread",show); return () => document.removeEventListener("review-focus-thread",show); }, []);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function act(threadId: string, action: "resolution" | "visibility", value: string, commentId?: string, confirmed = false) {
    if (action === "visibility" && value === "HIDDEN" && !confirmed) { setPendingHide({ threadId, commentId }); return; }
    setBusy(true); setError(undefined);
    try { await moderate?.(threadId, action, value, commentId); } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not update discussion."); } finally { setBusy(false); setPendingHide(undefined); }
  }
  const visible = threads.filter(thread => filter === "ALL" || thread.status === filter);
  return <div className="space-y-3">
    <ConfirmDialog open={!!pendingHide} onOpenChange={open => { if (!open) setPendingHide(undefined); }} title="Hide from reviewers?" description="This content will be hidden from all reviewers. It remains available to you for moderation." confirmLabel="Confirm hide" onConfirm={() => { if(pendingHide) void act(pendingHide.threadId,"visibility","HIDDEN",pendingHide.commentId,true); }} />
    {threads.length > 0 && <MenuRoot><MenuTrigger className={buttonClasses({ variant: "ghost" })} aria-label="Filter discussions">{filter === "ALL" ? "All comments" : filter === "OPEN" ? "Open" : "Resolved"}<ChevronDown className="size-4" aria-hidden="true" /></MenuTrigger><MenuContent>{(["ALL", "OPEN", "RESOLVED"] as const).map(value => <MenuItem key={value} onClick={() => setFilter(value)}>{value === "ALL" ? "All comments" : value === "OPEN" ? "Open" : "Resolved"}</MenuItem>)}</MenuContent></MenuRoot>}
    {error && <p role="alert" className="text-body-sm">{error}</p>}
    {visible.length === 0 && <p className="py-6 text-body-sm text-kh-text-muted">{threads.length === 0 ? "No comments yet." : "No comments here."}</p>}
    {visible.map(thread => {
      const owner = "visibility" in thread ? thread : undefined;
      return <section key={thread.id} data-review-thread={thread.id} tabIndex={-1} aria-label="Discussion thread" className="rounded-lg border border-kh-border bg-kh-bg p-4 kh-focus-ring focus:border-kh-primary">
        {(thread.status === "RESOLVED" || owner?.visibility === "HIDDEN" || thread.currentAnchor.match === "OUTDATED") && <p className="mb-2 text-caption text-kh-text-muted">{[thread.status === "RESOLVED" ? "Resolved" : "", owner?.visibility === "HIDDEN" ? "Hidden from reviewers" : "", thread.currentAnchor.match === "OUTDATED" ? "Passage outdated" : ""].filter(Boolean).join(" · ")}</p>}
        {thread.currentAnchor.anchor && <blockquote className="mb-3 border-l border-kh-border pl-3 text-body-sm text-kh-text-muted"><button type="button" disabled={!focusAnchor} className="line-clamp-2 text-left kh-focus-ring hover:text-kh-text" onClick={() => { document.dispatchEvent(new Event("review-focus-passage")); requestAnimationFrame(() => requestAnimationFrame(() => focusAnchor?.(thread.currentAnchor.anchor!))); }}>{thread.currentAnchor.anchor.exact}</button></blockquote>}
        {owner && thread.currentAnchor.match === "OUTDATED" && <blockquote className="mb-3 border-l border-kh-border pl-3 text-body-sm text-kh-text-muted">Original passage (owner only): {owner.originalAnchor.exact}</blockquote>}
        <ol className="space-y-4">{thread.comments.map((comment, index) => <li key={comment.id} className="text-body-sm">
          <div className="mb-2 flex items-start gap-2">
            <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-kh-bg-selected font-medium text-kh-selected-text">{(comment.authorName ?? "C").slice(0, 1).toUpperCase()}</span>
            <div className="min-w-0 flex-1"><p className="truncate font-medium">{comment.authorName ?? "Company colleague"}{comment.visibility === "HIDDEN" ? " · Hidden" : ""}</p><p className="text-caption text-kh-text-muted"><Timestamp value={comment.createdAt} /></p></div>
            {moderate && index === 0 && <Button type="button" variant="ghost" icon aria-label={thread.status === "OPEN" ? "Resolve" : "Reopen"} title={thread.status === "OPEN" ? "Resolve" : "Reopen"} disabled={busy || !canResolve} onClick={() => void act(thread.id, "resolution", thread.status === "OPEN" ? "RESOLVED" : "OPEN")}><Check className="size-4" aria-hidden="true" /></Button>}
            {moderate && <MenuRoot><MenuTrigger aria-label={index === 0 ? "Comment options" : "Reply options"} className={buttonClasses({variant:"ghost",icon:true})}><MoreHorizontal className="size-4" aria-hidden="true" /></MenuTrigger><MenuContent align="end"><MenuItem disabled={busy} onClick={() => void act(thread.id, "visibility", index === 0 ? (owner?.visibility === "HIDDEN" ? "VISIBLE" : "HIDDEN") : (comment.visibility === "HIDDEN" ? "VISIBLE" : "HIDDEN"), index === 0 ? undefined : comment.id)}>{index === 0 ? (owner?.visibility === "HIDDEN" ? "Unhide thread" : "Hide thread") : comment.visibility === "HIDDEN" ? "Unhide reply" : "Hide reply"}</MenuItem></MenuContent></MenuRoot>}
          </div>
          <p className="whitespace-pre-wrap break-words">{comment.body}</p>
        </li>)}</ol>
        {thread.status === "OPEN" && owner?.visibility !== "HIDDEN" && writesEnabled && <ReviewReplyForm onSubmit={(body, key) => reply(thread.id, body, key)} />}
      </section>;
    })}
  </div>;
}
