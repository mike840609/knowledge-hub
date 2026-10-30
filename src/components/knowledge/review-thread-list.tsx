"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { OwnerReviewThreadView, ReviewAnchor, ReviewThreadView } from "@/modules/knowledge/domain/document-review";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Timestamp } from "@/components/ui/timestamp";
import { Textarea } from "@/components/ui/textarea";
import { Bell, BellDot, BellOff, Check, ChevronDown, CircleArrowDown, MoreHorizontal } from "lucide-react";
import { MenuRoot, MenuTrigger, MenuContent, MenuItem, MenuRadioGroup, MenuRadioItem } from "@/components/ui/menu";
import { buttonClasses } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { compareReviewPassages, useReviewRailLayout, type RailCard } from "./review-rail-layout";
import { matchesShortcut } from "@/lib/shortcut-keys";
import { linkify } from "@/lib/linkify";
import { Popover } from "@base-ui-components/react/popover";
import { splitMentions, type MentionedPerson } from "@/modules/knowledge/domain/mention-text";
import { readStored, removeStored, writeStored } from "@/components/shell/use-persisted-state";
import { useMentionAutocomplete, type MentionScope } from "./mention-autocomplete";

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

export function ReviewReplyForm({ onSubmit, label = "Reply", openRequest = 0, initial = "", submitLabel = label, onCancel, submitDisabled = false, cancelOnEscape = false, draftKey, mentionScope }: { /** `mentions`: who the sent text names, picked from the `@` list; `mentionLinkId`: the owner's link they are reached through. */ onSubmit: (body: string, key: string, mentions: string[], mentionLinkId?: string) => Promise<void>; label?: string; /** Changes when the card's own Reply was pressed: open the form. */ openRequest?: number; /** An edit starts from what the comment says. */ initial?: string; submitLabel?: string; onCancel?: () => void; submitDisabled?: boolean; cancelOnEscape?: boolean; /** Keeps the unsent text (`reviewDraftKey`). */ draftKey?: string; /** Offers the `@` list; absent for an edit, which never adds a mention. */ mentionScope?: MentionScope }) {
  const [body, setBody] = useState(() => (draftKey && readStored("session", draftKey)) || initial);
  // A reply someone had started is open again, as they left it.
  const [expanded, setExpanded] = useState(() => label !== "Reply" || !!(draftKey && readStored("session", draftKey)));
  const keep = (value: string) => {
    setBody(value);
    if (!draftKey) return;
    if (value.trim() && value !== initial) writeStored("session", draftKey, value); else removeStored("session", draftKey);
  };
  const discard = () => { if (draftKey) removeStored("session", draftKey); };
  const mention = useMentionAutocomplete(mentionScope, body, keep, draftKey);
  useEffect(() => { if (openRequest > 0) setExpanded(true); }, [openRequest]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef<{ body: string; key: string } | null>(null);
  if (!expanded) return <Button type="button" variant="ghost" className="-ml-3 mt-3" onClick={() => setExpanded(true)}>Reply</Button>;
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
    const { mentions, mentionLinkId } = mention.collect(body);
    try { await onSubmit(body, request.current.key, mentions, mentionLinkId); setBody(""); discard(); mention.reset(); request.current = null; if (label === "Reply") setExpanded(false); } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save comment."); } finally { setBusy(false); }
  }}>
    <div className="relative"><Textarea {...mention.field} aria-label={label} placeholder={label === "Reply" ? "Reply…" : "Add a comment…"} rows={2} autoFocus className="!min-h-20 resize-y" value={body} disabled={busy} onChange={event => { keep(event.target.value); mention.track(); }} required maxLength={6000} />{mention.list}</div>
    {[...body].length >= 2700 && <p className="text-caption text-kh-text-muted">{[...body].length}/3,000</p>}
    {error && <p role="alert" className="text-body-sm">{error}</p>}
    {mention.linkChoice}
    <div className="flex justify-end gap-1">{(label === "Reply" || onCancel) && <Button type="button" variant="ghost" disabled={busy} onClick={() => { discard(); setBody(initial); mention.reset(); if (onCancel) onCancel(); else setExpanded(false); }}>Cancel</Button>}<Tooltip label={submitLabel} shortcut={SUBMIT_SHORTCUT}><Button type="submit" aria-keyshortcuts={SUBMIT_SHORTCUT} disabled={busy || submitDisabled || !body.trim() || [...body].length > 3000}>{busy ? "Saving…" : submitLabel}</Button></Tooltip></div>
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
  return <MenuRoot><MenuTrigger className={buttonClasses({ variant: "ghost" })} aria-label="Filter discussions">{FILTER_NAMES[value]}<ChevronDown className="size-4" aria-hidden="true" /></MenuTrigger><MenuContent><MenuRadioGroup value={value} onValueChange={next => onChange(next as ReviewFilter)}>{(Object.keys(FILTER_NAMES) as ReviewFilter[]).map(option => <MenuRadioItem key={option} value={option}>{FILTER_NAMES[option]}</MenuRadioItem>)}</MenuRadioGroup></MenuContent></MenuRoot>;
}

/** The first discussion after the active one, in passage order and round again, that `matches`; never the active one itself. */
export function nextReviewThreadId(threads: readonly RailCard[], activeThreadId: string | undefined, matches: (id: string) => boolean): string | undefined {
  const ordered = [...threads].sort(compareReviewPassages);
  const start = ordered.findIndex(thread => thread.id === activeThreadId) + 1;
  return [...ordered.slice(start), ...ordered.slice(0, start)].find(thread => thread.id !== activeThreadId && matches(thread.id))?.id;
}

/**
 * Steps through what wants attention: discussions with unread notices (the owner's) and open ones.
 * Focus stays on the button, so pressing again goes on to the next.
 */
export function ReviewNextButtons({ threads, activeThreadId, onActivate, filter, onFilterChange, unreadThreadIds }: { threads: readonly ReviewThreadView[]; activeThreadId?: string; onActivate: (threadId: string) => void; filter: ReviewFilter; onFilterChange: (filter: ReviewFilter) => void; unreadThreadIds?: ReadonlySet<string> }) {
  const status = new Map(threads.map(thread => [thread.id, thread.status]));
  const nextUnread = unreadThreadIds && nextReviewThreadId(threads, activeThreadId, id => unreadThreadIds.has(id));
  const nextOpen = nextReviewThreadId(threads, activeThreadId, id => status.get(id) === "OPEN");
  function go(threadId: string) {
    if (filter !== "ALL" && status.get(threadId) !== filter) onFilterChange("ALL");
    onActivate(threadId);
    // The card is drawn, and placed beside its passage, after this render.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const card = Array.from(document.querySelectorAll<HTMLElement>("[data-review-thread]")).find(item => item.dataset.reviewThread === threadId && item.getClientRects().length > 0);
      card?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }));
  }
  // Always drawn, disabled when there is nowhere to go: a row appearing or leaving would move the cards under the pointer.
  return <div className="mt-3 flex flex-wrap gap-1">
    {unreadThreadIds && <Button type="button" variant="ghost" disabled={!nextUnread} onClick={() => nextUnread && go(nextUnread)}><BellDot className="size-4" aria-hidden="true" />Next unread</Button>}
    <Button type="button" variant="ghost" disabled={!nextOpen} onClick={() => nextOpen && go(nextOpen)}><CircleArrowDown className="size-4" aria-hidden="true" />Next open</Button>
  </div>;
}

export function ReviewThreadList({ threads, writesEnabled, reply, moderate, author, canResolve = true, focusAnchor, railMarkdown, activeThreadId, onActivate, filter: controlled, onFilterChange, draft, signInHref, unreadThreadIds, follow, mentionScope }: {
  threads: (ReviewThreadView | OwnerReviewThreadView)[];
  writesEnabled: boolean;
  reply: (threadId: string, body: string, key: string, mentions: string[], mentionLinkId?: string) => Promise<void>;
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
  /** Discussions with notices the owner has not read. */
  unreadThreadIds?: ReadonlySet<string>;
  /** A signed-in reader's following; offered on a discussion that says whether it is followed. */
  follow?: (threadId: string, following: boolean) => Promise<void>;
  /** Offers the `@` list in replies (never in edits). */
  mentionScope?: MentionScope;
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
    {visible.length === 0 && !draft && <p className="py-6 text-body-sm text-kh-text-muted">{threads.length === 0 ? (writesEnabled ? "No comments yet. Select text in the document to start a discussion." : "No comments yet.") : filter === "OPEN" && threads.every(thread => thread.status === "RESOLVED") ? "Every discussion is resolved." : "No comments here."}</p>}
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
        {thread.currentAnchor.anchor && <blockquote className="mb-3 border-l border-kh-border pl-3 text-body-sm text-kh-text-muted"><button type="button" disabled={!focusAnchor} className={`${compact ? "line-clamp-2" : ""} break-words text-left kh-focus-ring hover:text-kh-text ${thread.currentAnchor.anchor.blockKind === "code" ? "whitespace-pre-wrap font-mono" : ""}`} onClick={() => {
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
          // The avatar is a column of its own; name, remark and forms share the column beside it.
          // Replies are the conversation's next lines, set off from the remark that opened it by a rule.
          return <li key={comment.id} className={`flex gap-2 text-body-sm ${index === 1 ? "border-t border-kh-border pt-4" : ""}`}>
          <Avatar name={comment.authorName} />
          <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-start gap-2">
            {/* Unread sits inside the name's line: it goes when the owner looks, and a line going would move the card's buttons from under a click. */}
            {/* Only the name gives way to a narrow rail: the time and Edited are never cut. The open card's full time is in the short one's tooltip, and spoken. */}
            <p className="flex min-w-0 flex-1 items-baseline gap-1 font-medium leading-6"><span className="truncate">{index === 0 && unreadThreadIds?.has(thread.id) && <><span aria-hidden="true" className="mr-1.5 inline-block size-1.5 rounded-full bg-kh-primary align-middle" /><span className="sr-only">Unread</span></>}{comment.authorName ?? "Company colleague"}{comment.visibility === "HIDDEN" ? " · Hidden" : ""}</span><span className="shrink-0 font-normal text-caption text-kh-text-muted">· <span aria-hidden={compact ? undefined : "true"}><Timestamp value={comment.createdAt} variant="short" /></span>{!compact && <Timestamp value={comment.createdAt} className="sr-only" />}{!compact && comment.editedAt ? " · Edited" : ""}</span></p>
            {/* The row keeps the name's 24px: its 32px buttons overhang it rather than push the remark down. */}
            <div className="-my-1 flex">
            {moderate && index === 0 && <Tooltip label={thread.status === "OPEN" ? "Resolve" : "Reopen"}><Button type="button" variant="ghost" icon aria-label={thread.status === "OPEN" ? "Resolve" : "Reopen"} disabled={busy || !canResolve} onClick={() => void act(thread.id, "resolution", thread.status === "OPEN" ? "RESOLVED" : "OPEN")}><Check className="size-4" aria-hidden="true" /></Button></Tooltip>}
            {(hides || mine) && <MenuRoot><MenuTrigger aria-label={index === 0 ? "Comment options" : "Reply options"} className={buttonClasses({variant:"ghost",icon:true})}><MoreHorizontal className="size-4" aria-hidden="true" /></MenuTrigger><MenuContent align="end">{canEdit && <MenuItem disabled={busy} onClick={() => setEditing(comment.id)}>Edit</MenuItem>}{mine && <MenuItem disabled={busy} onClick={() => setPendingDelete({ threadId: thread.id, commentId: comment.id })}>Delete</MenuItem>}{hides && <MenuItem disabled={busy} onClick={() => void act(thread.id, "visibility", index === 0 ? (owner?.visibility === "HIDDEN" ? "VISIBLE" : "HIDDEN") : (comment.visibility === "HIDDEN" ? "VISIBLE" : "HIDDEN"), index === 0 ? undefined : comment.id)}>{index === 0 ? (owner?.visibility === "HIDDEN" ? "Unhide thread" : "Hide thread") : comment.visibility === "HIDDEN" ? "Unhide reply" : "Hide reply"}</MenuItem>}</MenuContent></MenuRoot>}
            </div>
          </div>
          {comment.deleted
            ? <p className="text-kh-text-muted">Comment deleted by author</p>
            : editing === comment.id && canEdit && !compact
              ? <ReviewReplyForm label="Edit comment" submitLabel="Save" initial={comment.body} onCancel={() => setEditing(undefined)} onSubmit={async body => { await author!.edit(thread.id, comment.id, body); setEditing(undefined); }} />
              : <CommentBody body={comment.body} compact={compact} mentions={comment.mentions} onClamped={index === 0 ? value => setClamped(previous => previous[thread.id] === value ? previous : { ...previous, [thread.id]: value }) : undefined} />}
          </div>
        </li>; })}</ol>
        {/* What follows the remarks starts on their column, past an empty avatar column; a ghost button's -ml-3 puts its label, not its box, there. */}
        <div className="flex gap-2"><span aria-hidden="true" className="w-6 shrink-0" /><div className="min-w-0 flex-1">
        {/* A preview's one button. With replies to show, it shows them. With only the remark — which
            the preview already is — opening the card would reveal nothing but Reply, so it is Reply:
            one step from reading to answering, and focus lands in the form. Where no reply can be
            made it opens the card, for the full text. */}
        {compact && (thread.comments.length === 1 && canReply
          ? <Button type="button" variant="ghost" className="-ml-3 mt-2" onClick={() => { onActivate?.(thread.id); setReplyRequest(previous => ({ threadId: thread.id, nonce: (previous?.nonce ?? 0) + 1 })); }}>Reply</Button>
          : thread.comments.length === 1 && signInHref && thread.status === "OPEN"
          ? <a href={signInHref} className={`-ml-3 mt-2 ${buttonClasses({ variant: "ghost" })}`} onClick={event => event.stopPropagation()}>Sign in to reply</a>
          // Opened, a lone remark shows only what was cut: with nothing cut, there is nothing to open.
          : (thread.comments.length > 1 || clamped[thread.id]) && <Button type="button" variant="ghost" className="-ml-3 mt-2" onClick={event => { event.currentTarget.closest<HTMLElement>("[data-review-thread]")?.focus({ preventScroll: true }); onActivate?.(thread.id); }}>{thread.comments.length > 1 ? `Show ${thread.comments.length - 1} ${thread.comments.length === 2 ? "reply" : "replies"}` : "Expand comment"}</Button>)}
        {compact && canReply && readStored("session", reviewDraftKey("reply", thread.id)) && <p className="mt-2 text-caption text-kh-text-muted">Unsent reply</p>}
        {follow && thread.following !== undefined && !compact && <div className="mt-2 flex justify-end"><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={async event => {
          event.stopPropagation(); setBusy(true); setError(undefined);
          try { await follow(thread.id, !thread.following); } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not update following."); } finally { setBusy(false); }
        }}>{thread.following ? <BellOff className="size-4" aria-hidden="true" /> : <Bell className="size-4" aria-hidden="true" />}{thread.following ? "Unfollow" : "Follow replies"}</Button></div>}
        {canReply && <div hidden={compact}><ReviewReplyForm draftKey={reviewDraftKey("reply", thread.id)} openRequest={replyRequest?.threadId === thread.id ? replyRequest.nonce : 0} mentionScope={mentionScope} onSubmit={(body, key, mentions, mentionLinkId) => reply(thread.id, body, key, mentions, mentionLinkId)} /></div>}
        </div></div>
      </section>;
      });
      const first = group.threads[0];
      const cover = first.comments[0];
      return [<section key={group.key} data-review-thread={first.id} data-stacked="" aria-label={`${group.threads.length} discussions on this passage`} style={layout ? { "--review-thread-top": `${layout.positions[first.id] ?? 0}px` } as CSSProperties : undefined} className="rounded-md border border-kh-border bg-kh-bg p-3">
        {first.currentAnchor.anchor && <blockquote className="mb-3 border-l border-kh-border pl-3 text-body-sm text-kh-text-muted"><span className="line-clamp-2 break-words">{first.currentAnchor.anchor.exact}</span></blockquote>}
        {cover && !cover.deleted && <div className="mb-2 flex gap-2 text-body-sm">
          <Avatar name={cover.authorName} />
          <div className="min-w-0 flex-1">
            <p className="mb-1 truncate font-medium leading-6">{cover.authorName ?? "Company colleague"}</p>
            <p className="whitespace-pre-wrap break-words line-clamp-2">{cover.body}</p>
          </div>
        </div>}
        {/* On the remark's column when the cover shows one (24px avatar + 8px gap - the label's 12px), else on the card's. */}
        <Button type="button" variant="ghost" className={`${cover && !cover.deleted ? "ml-5" : "-ml-3"} mt-2`} onClick={() => setExpandedGroups(previous => ({ ...previous, [group.key]: true }))}>Show {group.threads.length} discussions</Button>
      </section>];
    })}
    </div>
  </div>;
}

/** An author's initial. A bordered page-coloured disc, so it stands out on a plain card and on the selected card's `bg-selected` alike. */
function Avatar({ name }: { name?: string | null }) {
  return <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full border border-kh-border bg-kh-bg font-medium text-kh-text">{(name ?? "C").slice(0, 1).toUpperCase()}</span>;
}

/** A remark as text, its http(s) links made links; a preview is held to two lines and says whether it was cut. */
function CommentBody({ body, compact, onClamped, mentions }: { body: string; compact: boolean; onClamped?: (clamped: boolean) => void; mentions?: readonly MentionedPerson[] }) {
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
      : splitMentions(part.text, mentions ?? []).map((piece, at) => piece.people
        ? <MentionCard key={`${index}-${at}`} text={piece.text} people={piece.people} />
        : piece.text))}
  </p>;
}

/**
 * A real `@name` of a comment: a button that opens who it is, on hover, focus and tap.
 * Everyone the comment mentioned under that name is listed, one row each. Text only.
 */
function MentionCard({ text, people }: { text: string; people: readonly MentionedPerson[] }) {
  const [open, setOpen] = useState(false);
  // Set by any close: focus handed back to the trigger afterwards (Escape) must not open the card again.
  const closed = useRef(false);
  return <Popover.Root open={open} onOpenChange={next => { if (!next) closed.current = true; setOpen(next); }}>
    <Popover.Trigger openOnHover delay={150} closeDelay={100} aria-label={`${people[0].name}, mentioned`} onPointerDown={() => { closed.current = false; }} onBlur={() => { closed.current = false; }}
      onFocus={event => { if (!closed.current && event.currentTarget.matches(":focus-visible")) setOpen(true); }}
      onClick={event => event.stopPropagation()} render={<button type="button" />}
      className="font-medium text-kh-link kh-focus-ring">{text}</Popover.Trigger>
    <Popover.Portal>
      <Popover.Positioner side="bottom" align="start" sideOffset={4} className="z-[80]">
        <Popover.Popup data-mention-card="" initialFocus={false} onClick={event => event.stopPropagation()}
          className={"flex max-w-[18rem] break-words flex-col gap-2 rounded-lg border border-kh-border bg-kh-bg p-3 text-body-sm text-kh-text shadow-popover outline-none " +
            "transition-[opacity,transform] duration-120 ease-out data-[starting-style]:opacity-0 data-[ending-style]:opacity-0"}>
          {people.map(person => <div key={person.empId}>
            <p className="font-medium">{person.name}</p>
            <p className="text-caption text-kh-text-muted">{[person.nameEn, person.empId].filter(Boolean).join(" · ")}</p>
          </div>)}
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  </Popover.Root>;
}
