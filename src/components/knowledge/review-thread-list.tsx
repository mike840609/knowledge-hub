"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { OwnerReviewThreadView, ReviewAnchor, ReviewThreadView } from "@/modules/knowledge/domain/document-review";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Timestamp } from "@/components/ui/timestamp";
import { Textarea } from "@/components/ui/textarea";
import { Check, ChevronDown, MoreHorizontal } from "lucide-react";
import { MenuRoot, MenuTrigger, MenuContent, MenuItem } from "@/components/ui/menu";
import { buttonClasses } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { compareReviewPassages, useReviewRailLayout, type RailCard } from "./review-rail-layout";
import { matchesShortcut } from "@/lib/shortcut-keys";
import { linkify } from "@/lib/linkify";
import { readStored, removeStored, writeStored } from "@/components/shell/use-persisted-state";

/** Sends what is written, as it saves a document in the composer. Enter alone stays a line of the comment. */
const SUBMIT_SHORTCUT = "Meta+Enter Control+Enter";

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
/**
 * Where an unsent remark is kept, for this tab only (`sessionStorage`): a reload, a page left and
 * come back to, or a failed send does not lose it; sending or Cancel does.
 */
export const reviewDraftKey = (kind: "reply" | "new", id: string) => `kh:review-draft:${kind}:${id}`;

export function ReviewReplyForm({ onSubmit, label = "Reply", openRequest = 0, initial = "", submitLabel = label, onCancel, submitDisabled = false, cancelOnEscape = false, draftKey }: { onSubmit: (body: string, key: string) => Promise<void>; label?: string; /** Changes when the card's own Reply was pressed: open the form. */ openRequest?: number; /** An edit starts from what the comment says. */ initial?: string; submitLabel?: string; onCancel?: () => void; submitDisabled?: boolean; cancelOnEscape?: boolean; /** Keeps the unsent text (`reviewDraftKey`). */ draftKey?: string }) {
  const [body, setBody] = useState(() => (draftKey && readStored("session", draftKey)) || initial);
  // A reply someone had started is open again, as they left it.
  const [expanded, setExpanded] = useState(() => label !== "Reply" || !!(draftKey && readStored("session", draftKey)));
  const keep = (value: string) => {
    setBody(value);
    if (!draftKey) return;
    if (value.trim() && value !== initial) writeStored("session", draftKey, value); else removeStored("session", draftKey);
  };
  const discard = () => { if (draftKey) removeStored("session", draftKey); };
  useEffect(() => { if (openRequest > 0) setExpanded(true); }, [openRequest]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef<{ body: string; key: string } | null>(null);
  if (!expanded) return <Button type="button" variant="ghost" className="mt-3" onClick={() => setExpanded(true)}>Reply</Button>;
  return <form className="mt-3 space-y-2" onKeyDown={event => {
    // Through the form's own button, so the key does nothing the button would not.
    if (matchesShortcut(event.nativeEvent, SUBMIT_SHORTCUT)) { event.preventDefault(); event.currentTarget.querySelector<HTMLButtonElement>('button[type="submit"]:not(:disabled)')?.click(); return; }
    if (event.key !== "Escape") return;
    // Esc never closes the rail from here, and never discards: it leaves only an edit nothing was changed in.
    event.preventDefault(); event.stopPropagation();
    if (onCancel && !busy && (cancelOnEscape || body === initial)) onCancel();
  }} onSubmit={async event => {
    event.preventDefault(); if (busy || submitDisabled || !body.trim()) return;
    if (!request.current || request.current.body !== body) request.current = { body, key: crypto.randomUUID() };
    setBusy(true); setError(undefined);
    try { await onSubmit(body, request.current.key); setBody(""); discard(); request.current = null; if (label === "Reply") setExpanded(false); } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save comment."); } finally { setBusy(false); }
  }}>
    <Textarea aria-label={label} placeholder={label === "Reply" ? "Reply…" : "Add a comment…"} rows={2} autoFocus className="!min-h-20 resize-y" value={body} disabled={busy} onChange={event => keep(event.target.value)} required maxLength={6000} />
    {[...body].length >= 2700 && <p className="text-caption text-kh-text-muted">{[...body].length}/3,000</p>}
    {error && <p role="alert" className="text-body-sm">{error}</p>}
    <div className="flex justify-end gap-1">{(label === "Reply" || onCancel) && <Button type="button" variant="ghost" disabled={busy} onClick={() => { discard(); setBody(initial); if (onCancel) onCancel(); else setExpanded(false); }}>Cancel</Button>}<Tooltip label={submitLabel} shortcut={SUBMIT_SHORTCUT}><Button type="submit" aria-keyshortcuts={SUBMIT_SHORTCUT} disabled={busy || submitDisabled || !body.trim() || [...body].length > 3000}>{busy ? "Saving…" : submitLabel}</Button></Tooltip></div>
  </form>;
}

export type ReviewFilter = "ALL" | "OPEN" | "RESOLVED";
/** The draft's place in the rail layout; no thread ID (a UUID) can equal it. */
const DRAFT_ID = "draft";
/** Threads on one passage read as one entry from this many on. */
const GROUP_THRESHOLD = 3;
const FILTER_NAMES: Record<ReviewFilter, string> = { ALL: "All comments", OPEN: "Open", RESOLVED: "Resolved" };

/** Which discussions are listed. The list draws it above itself unless a panel takes it for its heading. */
export function ReviewFilterMenu({ value, onChange }: { value: ReviewFilter; onChange: (value: ReviewFilter) => void }) {
  return <MenuRoot><MenuTrigger className={buttonClasses({ variant: "ghost" })} aria-label="Filter discussions">{FILTER_NAMES[value]}<ChevronDown className="size-4" aria-hidden="true" /></MenuTrigger><MenuContent>{(Object.keys(FILTER_NAMES) as ReviewFilter[]).map(option => <MenuItem key={option} onClick={() => onChange(option)}>{FILTER_NAMES[option]}</MenuItem>)}</MenuContent></MenuRoot>;
}

export function ReviewThreadList({ threads, writesEnabled, reply, moderate, author, canResolve = true, focusAnchor, railMarkdown, activeThreadId, onActivate, filter: controlled, onFilterChange, draft, signInHref }: {
  threads: (ReviewThreadView | OwnerReviewThreadView)[];
  writesEnabled: boolean;
  reply: (threadId: string, body: string, key: string) => Promise<void>;
  focusAnchor?: (anchor: NonNullable<ReviewThreadView["currentAnchor"]["anchor"]>) => void;
  canResolve?: boolean;
  moderate?: (threadId: string, action: "resolution" | "visibility", value: string, commentId?: string) => Promise<void>;
  /** What the caller may do to a comment of their own. The service decides again whose it is. */
  author?: { edit: (threadId: string, commentId: string, body: string) => Promise<void>; remove: (threadId: string, commentId: string) => Promise<void> };
  railMarkdown?: string;
  activeThreadId?: string;
  onActivate?: (threadId: string) => void;
  /** Given both, the filter is the caller's — state and control — and the list draws none of its own. */
  filter?: ReviewFilter;
  onFilterChange?: (filter: ReviewFilter) => void;
  /** A new comment being written, placed in the rail level with its passage, ahead of every card. */
  draft?: { anchor: ReviewAnchor; composer: ReactNode };
  /** The reader is not signed in: an open discussion offers sign-in where a signed-in one offers Reply. */
  signInHref?: string;
}) {
  // Which previews cut their remark short: only those have more to show when opened.
  const [clamped, setClamped] = useState<Record<string, boolean>>({});
  const [pendingHide, setPendingHide] = useState<{ threadId: string; commentId?: string }>();
  const [pendingDelete, setPendingDelete] = useState<{ threadId: string; commentId: string }>();
  const [editing, setEditing] = useState<string>();
  async function remove(target: { threadId: string; commentId: string }) {
    setBusy(true); setError(undefined);
    try { await author?.remove(target.threadId, target.commentId); } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not delete comment."); } finally { setBusy(false); setPendingDelete(undefined); }
  }
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
  // Keyed on the anchor: the composer element is new on every render, the place it needs is not.
  const draftAnchor = draft?.anchor;
  const placed = useMemo<RailCard[]>(() => !draftAnchor ? visible
    : [...visible, { id: DRAFT_ID, currentAnchor: { match: "MATCHED" as const, anchor: draftAnchor } }].sort(compareReviewPassages), [visible, draftAnchor]);
  const { ref: railRef, layout } = useReviewRailLayout(placed, railMarkdown, draft ? DRAFT_ID : activeThreadId);
  /** Threads on one passage read as one entry once there are enough of them to push others away. */
  const groups = useMemo(() => {
    const ordered: { key: string; threads: typeof visible }[] = [];
    const byKey = new Map<string, typeof visible>();
    for (const thread of visible) {
      const anchor = thread.currentAnchor.match === "OUTDATED" ? undefined : thread.currentAnchor.anchor;
      const key = anchor ? `block:${JSON.stringify(anchor.blockPath)}` : `thread:${thread.id}`;
      const found = byKey.get(key);
      if (found) found.push(thread);
      else { byKey.set(key, [thread]); ordered.push({ key, threads: byKey.get(key)! }); }
    }
    return ordered;
  }, [visible]);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const firstGroupKey = groups[0]?.key;
  return <div className="space-y-3">
    <ConfirmDialog open={!!pendingHide} onOpenChange={open => { if (!open) setPendingHide(undefined); }} title="Hide from reviewers?" description="This content will be hidden from all reviewers. It remains available to you for moderation." confirmLabel="Confirm hide" onConfirm={() => { if(pendingHide) void act(pendingHide.threadId,"visibility","HIDDEN",pendingHide.commentId,true); }} />
    <ConfirmDialog open={!!pendingDelete} onOpenChange={open => { if (!open) setPendingDelete(undefined); }} title="Delete comment?" description="Your comment will be removed for everyone. This cannot be undone." confirmLabel="Delete comment" onConfirm={() => { if (pendingDelete) void remove(pendingDelete); }} />
    {threads.length > 0 && !onFilterChange && <ReviewFilterMenu value={filter} onChange={setFilter} />}
    {error && <p role="alert" className="text-body-sm">{error}</p>}
    {visible.length === 0 && !draft && <p className="py-6 text-body-sm text-kh-text-muted">{threads.length === 0 ? "No comments yet." : "No comments here."}</p>}
    <div ref={railRef} data-review-rail={railMarkdown !== undefined ? "" : undefined} data-positioned={layout ? "" : undefined} className="kh-review-thread-list" style={layout ? { "--review-list-height": `${layout.height}px` } as CSSProperties : undefined}>
    {/* The box is placed before its field mounts: the field takes focus on mounting, and focused at the rail's top it scrolls the page away from the passage. */}
    {draft && <section data-review-draft={DRAFT_ID} aria-label="New comment" style={layout ? { "--review-thread-top": `${layout.positions[DRAFT_ID] ?? 0}px` } as CSSProperties : undefined}>{layout?.positions[DRAFT_ID] !== undefined && draft.composer}</section>}
    {groups.flatMap(group => {
      // The passage being read and the first group start expanded; the rest open on demand.
      const expanded = expandedGroups[group.key] ?? (group.key === firstGroupKey || group.threads.some(item => item.id === activeThreadId));
      if (group.threads.length < GROUP_THRESHOLD || expanded) return group.threads.map(thread => {
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
        <ol className="space-y-4">{(compact ? thread.comments.slice(0, 1) : thread.comments).map((comment, index) => {
          // A preview keeps its one button: what an author may do to their comment waits for the open card.
          const mine = !!author && comment.own && !comment.deleted && !(compact && !moderate);
          // An edit is a write, held to what a reply is; a retraction is not.
          const canEdit = mine && canReply && comment.visibility !== "HIDDEN";
          const hides = !!moderate && (index === 0 || !comment.deleted);
          return <li key={comment.id} className="text-body-sm">
          <div className="mb-2 flex items-start gap-2">
            <span aria-hidden="true" className={`flex ${compact ? "size-6" : "size-8"} shrink-0 items-center justify-center rounded-full bg-kh-bg-selected font-medium text-kh-selected-text`}>{(comment.authorName ?? "C").slice(0, 1).toUpperCase()}</span>
            <div className="min-w-0 flex-1"><p className="truncate font-medium">{comment.authorName ?? "Company colleague"}{comment.visibility === "HIDDEN" ? " · Hidden" : ""}{compact && <span className="font-normal text-caption text-kh-text-muted"> · <Timestamp value={comment.createdAt} variant="short" /></span>}</p>{!compact && <p className="text-caption text-kh-text-muted"><Timestamp value={comment.createdAt} />{comment.editedAt ? " · Edited" : ""}</p>}</div>
            {moderate && index === 0 && <Tooltip label={thread.status === "OPEN" ? "Resolve" : "Reopen"}><Button type="button" variant="ghost" icon aria-label={thread.status === "OPEN" ? "Resolve" : "Reopen"} disabled={busy || !canResolve} onClick={() => void act(thread.id, "resolution", thread.status === "OPEN" ? "RESOLVED" : "OPEN")}><Check className="size-4" aria-hidden="true" /></Button></Tooltip>}
            {(hides || mine) && <MenuRoot><MenuTrigger aria-label={index === 0 ? "Comment options" : "Reply options"} className={buttonClasses({variant:"ghost",icon:true})}><MoreHorizontal className="size-4" aria-hidden="true" /></MenuTrigger><MenuContent align="end">{canEdit && <MenuItem disabled={busy} onClick={() => setEditing(comment.id)}>Edit</MenuItem>}{mine && <MenuItem disabled={busy} onClick={() => setPendingDelete({ threadId: thread.id, commentId: comment.id })}>Delete</MenuItem>}{hides && <MenuItem disabled={busy} onClick={() => void act(thread.id, "visibility", index === 0 ? (owner?.visibility === "HIDDEN" ? "VISIBLE" : "HIDDEN") : (comment.visibility === "HIDDEN" ? "VISIBLE" : "HIDDEN"), index === 0 ? undefined : comment.id)}>{index === 0 ? (owner?.visibility === "HIDDEN" ? "Unhide thread" : "Hide thread") : comment.visibility === "HIDDEN" ? "Unhide reply" : "Hide reply"}</MenuItem>}</MenuContent></MenuRoot>}
          </div>
          {comment.deleted
            ? <p className="text-kh-text-muted">Comment deleted by author</p>
            : editing === comment.id && canEdit && !compact
              ? <ReviewReplyForm label="Edit comment" submitLabel="Save" initial={comment.body} onCancel={() => setEditing(undefined)} onSubmit={async body => { await author!.edit(thread.id, comment.id, body); setEditing(undefined); }} />
              : <CommentBody body={comment.body} compact={compact} onClamped={index === 0 ? value => setClamped(previous => previous[thread.id] === value ? previous : { ...previous, [thread.id]: value }) : undefined} />}
        </li>; })}</ol>
        {/* A preview's one button. With replies to show, it shows them. With only the remark — which
            the preview already is — opening the card would reveal nothing but Reply, so it is Reply:
            one step from reading to answering, and focus lands in the form. Where no reply can be
            made it opens the card, for the full text and its time. */}
        {compact && (thread.comments.length === 1 && canReply
          ? <Button type="button" variant="ghost" className="mt-2" onClick={() => { onActivate?.(thread.id); setReplyRequest(previous => ({ threadId: thread.id, nonce: (previous?.nonce ?? 0) + 1 })); }}>Reply</Button>
          : thread.comments.length === 1 && signInHref && thread.status === "OPEN"
          ? <a href={signInHref} className={`mt-2 ${buttonClasses({ variant: "ghost" })}`} onClick={event => event.stopPropagation()}>Sign in to reply</a>
          // Opened, a lone remark shows only what was cut: with nothing cut, there is nothing to open.
          : (thread.comments.length > 1 || clamped[thread.id]) && <Button type="button" variant="ghost" className="mt-2" onClick={event => { event.currentTarget.closest<HTMLElement>("[data-review-thread]")?.focus({ preventScroll: true }); onActivate?.(thread.id); }}>{thread.comments.length > 1 ? `Show ${thread.comments.length - 1} ${thread.comments.length === 2 ? "reply" : "replies"}` : "Expand comment"}</Button>)}
        {compact && canReply && readStored("session", reviewDraftKey("reply", thread.id)) && <p className="mt-2 text-caption text-kh-text-muted">Unsent reply</p>}
        {canReply && <div hidden={compact}><ReviewReplyForm draftKey={reviewDraftKey("reply", thread.id)} openRequest={replyRequest?.threadId === thread.id ? replyRequest.nonce : 0} onSubmit={(body, key) => reply(thread.id, body, key)} /></div>}
      </section>;
      });
      const first = group.threads[0];
      const cover = first.comments[0];
      return [<section key={group.key} data-review-thread={first.id} data-stacked="" aria-label={`${group.threads.length} discussions on this passage`} style={layout ? { "--review-thread-top": `${layout.positions[first.id] ?? 0}px` } as CSSProperties : undefined} className="rounded-md border border-kh-border bg-kh-bg p-3">
        {first.currentAnchor.anchor && <blockquote className="mb-3 border-l border-kh-border pl-3 text-body-sm text-kh-text-muted"><span className="line-clamp-2">{first.currentAnchor.anchor.exact}</span></blockquote>}
        {cover && !cover.deleted && <div className="mb-2 text-body-sm">
          <div className="mb-2 flex items-start gap-2">
            <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-kh-bg-selected font-medium text-kh-selected-text">{(cover.authorName ?? "C").slice(0, 1).toUpperCase()}</span>
            <div className="min-w-0 flex-1"><p className="truncate font-medium">{cover.authorName ?? "Company colleague"}</p></div>
          </div>
          <p className="whitespace-pre-wrap break-words line-clamp-2">{cover.body}</p>
        </div>}
        <Button type="button" variant="ghost" className="mt-2" onClick={() => setExpandedGroups(previous => ({ ...previous, [group.key]: true }))}>Show {group.threads.length} discussions</Button>
      </section>];
    })}
    </div>
  </div>;
}

/** A remark as text, its http(s) links made links; a preview is held to two lines and says whether it was cut. */
function CommentBody({ body, compact, onClamped }: { body: string; compact: boolean; onClamped?: (clamped: boolean) => void }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !onClamped) return;
    const measure = () => onClamped(compact && element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [compact, body, onClamped]);
  return <p ref={ref} className={`whitespace-pre-wrap break-words ${compact ? "line-clamp-2" : ""}`}>
    {linkify(body).map((part, index) => part.href
      ? <a key={index} href={part.href} target="_blank" rel="noopener noreferrer" className="font-medium text-kh-link underline decoration-kh-link underline-offset-2 kh-focus-ring" onClick={event => event.stopPropagation()}>{part.text}</a>
      : part.text)}
  </p>;
}
