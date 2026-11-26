"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ReviewAnchor, ReviewThreadView } from "@/modules/knowledge/domain/document-review";
import { drawnReviewThreads, useReviewDraftHighlight, useReviewHighlights } from "./review-highlights";
import { LogIn, RefreshCw, MessageSquare, MessageSquarePlus, X } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { ReviewFilterMenu, ReviewNextButtons, ReviewThreadList, reviewDraftKey, reviewRequest, reviewShows, type ReviewFilter, type ReviewShow } from "./review-thread-list";
import { CommentShortcutTip, ReviewComposer, ReviewSelectionBubble, useReviewSelection } from "./review-composer";
import { ReviewPanelShell } from "./review-panel-shell";
import { ReviewBlockComment } from "./review-block-comment";
import { COMMENT_HINT, createReviewRangeResolver, focusReviewAnchor, selectionAnchorInBlock } from "./review-selection";
import { ReviewPassageMarkers } from "./review-passage-markers";
import { reviewRailInline, useReviewRailInline, useReviewRailOpen } from "./review-rail-mode";
import { awaitingReader, newComments, parseDismissed, sharedDismissedKey } from "./review-auto-open";
import { readStored, removeStored, writeStored } from "@/components/shell/use-persisted-state";
import { COMMENT_SHORTCUT, useCommentShortcut } from "./review-shortcut";
import { shareDiscussionLink, sharedPagePath } from "@/lib/share-paths";

const SHOWS: readonly ReviewShow[] = ["ANYONE", "MINE", "MENTIONS"];
type DiscussionResult = { threads: ReviewThreadView[]; revisionId: string; writesEnabled: boolean; callerUserId: string | null };
/**
 * `brand` and `actions` (the page's own: Download, Save, Open; the Hub reader passes Download only) share the one pinned bar with Comments, so nothing stands between it and the title.
 * On a folder link's page `documentId` names the document being read: every request carries it, and what this
 * reader keeps on the device (dismissals, an unsent comment) is kept per document. The bar is `wide` there, spanning
 * the window over the tree as the folder page's own bar does, with `brand` holding the tree, brand and breadcrumb.
 */
export function SharedReviewPanel({ token, documentId, revisionId, markdown, signInHref, brand, actions, wide = false, children }: { token: string; documentId?: string; revisionId: string; markdown: string; signInHref: string; brand?: ReactNode; actions?: ReactNode; wide?: boolean; children: ReactNode }) {
  // A document link's page keeps the keys it always had, so a reader's stored drafts and dismissals still match.
  const kept = documentId ? `${token}:${documentId}` : token;
  const scope = useMemo(() => (documentId ? { token, documentId } : { token }), [token, documentId]);
  const [result, setResult] = useState<DiscussionResult>();
  const [error, setError] = useState<string>();
  const [activeThreadId, setActiveThreadId] = useState<string>();
  const entryRef = useRef<HTMLButtonElement>(null);
  const readingRef = useRef<HTMLDivElement>(null);
  // The drawer's CTA closes the drawer to free the text; focus follows it back to the article, not the entry button.
  const focusArticleAfterClose = useRef(false);
  // Every way the rail opens and closes holds the reader's place.
  const [open, setOpen, holdAt] = useReviewRailOpen(readingRef);
  const inline = useReviewRailInline();
  // Open first, as the owner's list and Google Docs start: settled discussions are under Resolved (2026-11-26 amendment).
  const [filter, setFilter] = useState<ReviewFilter>("OPEN");
  // Whose discussions: Mine and Mentions me are offered to a signed-in reader only (2026-11-26).
  const [show, setShow] = useState<ReviewShow>("ANYONE");
  const shown = useRef<DiscussionResult | undefined>(undefined);
  useEffect(() => { shown.current = result; }, [result]);
  // The reader's own opening and closing. Closing is remembered as the discussions it was closed on,
  // so the rail stays shut on those and opens again for one that arrives later (as the owner's does).
  const changeOpen = useCallback((next: boolean) => {
    setOpen(next);
    if (next) removeStored("local", sharedDismissedKey(kept));
    else writeStored("local", sharedDismissedKey(kept), JSON.stringify(awaitingReader(shown.current?.threads ?? [])));
    if (!next) {
      setActiveThreadId(undefined);
      if (reviewRailInline()) entryRef.current?.focus({ preventScroll: true });
    }
  }, [kept]);
  const toggle = useCallback(() => changeOpen(!open), [changeOpen, open]);
  const revisionChanged = !!result && result.revisionId !== revisionId;
  const canComment = !!result?.writesEnabled && !revisionChanged;
  const anonymous = result?.callerUserId === null;
  // Discussions are what a reviewer came for: where they fit beside the document, they open with it
  // (once) — unless this reader closed them on every discussion still waiting for them.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || !result || !inline) return;
    autoOpened.current = true;
    const dismissed = parseDismissed(readStored("local", sharedDismissedKey(kept)));
    if (awaitingReader(result.threads).some(id => !dismissed.includes(id))) setOpen(true);
  }, [result, inline, kept]);
  // `?thread=` (an Inbox entry) opens the discussions on that one, once, where it is listed; an unknown id does nothing.
  const deepLinked = useRef(false);
  const [arrivedThreadId, setArrivedThreadId] = useState<string>();
  useEffect(() => {
    if (deepLinked.current || !result) return;
    deepLinked.current = true;
    const thread = result.threads.find(candidate => candidate.id === new URLSearchParams(window.location.search).get("thread"));
    if (!thread) return;
    // Only a list that hides it is changed: an open discussion is listed by the Open it starts on.
    if (thread.status === "RESOLVED") setFilter("ALL");
    setShow(current => reviewShows(thread, current) ? current : "ANYONE"); setActiveThreadId(thread.id); setArrivedThreadId(thread.id); setOpen(true);
    const anchor = revisionChanged ? undefined : thread.currentAnchor.anchor;
    const root = document.querySelector<HTMLElement>("[data-review-document]");
    if (anchor && root) requestAnimationFrame(() => requestAnimationFrame(() => focusReviewAnchor(root, markdown, anchor)));
  }, [result, revisionChanged, markdown]);
  // Looking at a discussion one follows, or one the Inbox brought the reader to (a mention need not be
  // followed), marks it seen. A failure retries once, then waits for the next look.
  const following = result?.threads.find(thread => thread.id === activeThreadId)?.following;
  const seeing = following || (!!activeThreadId && activeThreadId === arrivedThreadId);
  useEffect(() => {
    if (!activeThreadId || !seeing) return;
    const send = () => reviewRequest(`/api/share-review/threads/${activeThreadId}/seen`, scope);
    void send().catch(() => send()).then(() => window.dispatchEvent(new Event("kh:notification-changed")), () => undefined);
  }, [activeThreadId, seeing, scope]);
  // A resolved passage is not marked under Open, unless it is the one being looked at (2026-11-26).
  const drawn = useMemo(() => revisionChanged ? undefined : drawnReviewThreads(result?.threads, filter, activeThreadId), [revisionChanged, result, filter, activeThreadId]);
  useReviewHighlights(markdown, drawn, activeThreadId);
  const selection = useReviewSelection(readingRef, markdown, `${token}:${revisionId}`);
  useReviewDraftHighlight(readingRef, revisionChanged ? null : selection.chosen, markdown);
  // A newer reading, held back while it would move the cards: the reader chooses when to see it.
  const [arrived, setArrived] = useState<{ result: DiscussionResult; count: number }>();
  // A read again keeps what is shown, says it is updating, and on failure says so beside it.
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setError(undefined);
    if (shown.current) setRefreshing(true);
    try { setResult(await reviewRequest<DiscussionResult>("/api/share-review/threads/query", scope)); setArrived(undefined); } catch (failure) { if (!shown.current) setResult(undefined); setError(failure instanceof Error ? failure.message : "Comments are unavailable."); } finally { setRefreshing(false); }
  }, [scope]);
  const openCount = result?.threads.filter(thread => thread.status === "OPEN").length ?? 0;
  const allResolved = !!result && result.threads.length > 0 && openCount === 0;
  useEffect(() => { void load(); }, [load]);
  // Coming back to the tab reads the discussions again. Nothing new is taken in quietly; new
  // comments wait behind a notice, so a card is never moved under the reader.
  useEffect(() => {
    const back = async () => {
      if (document.visibilityState !== "visible" || !shown.current) return;
      try {
        const next = await reviewRequest<DiscussionResult>("/api/share-review/threads/query", scope);
        const count = shown.current ? newComments(shown.current.threads, next.threads) : 0;
        if (count === 0) setResult(next); else setArrived({ result: next, count });
      } catch { /* What is shown stays; Refresh still reads again. */ }
    };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [scope]);
  const showArrived = () => { if (!arrived) return; setResult(arrived.result); setArrived(undefined); changeOpen(true); };
  useEffect(() => { setActiveThreadId(undefined); }, [kept, revisionId, markdown]);
  useEffect(() => {
    const activate = (event: Event) => setActiveThreadId((event as CustomEvent<string>).detail);
    document.addEventListener("review-focus-thread", activate);
    return () => document.removeEventListener("review-focus-thread", activate);
  }, []);
  // An unsent new comment is kept with its passage, so a reload brings both back (spec amendment 2026-10-21).
  const draftKey = reviewDraftKey("new", kept);
  const anchorKey = `${draftKey}:anchor`;
  // The passage an anonymous reader chose before leaving to sign in, with the revision it was chosen
  // in. Only what this tab shows itself on return: the comment is still the signed-in reader's write,
  // judged by the service as any other.
  const signInKey = `${draftKey}:sign-in`;
  const [restored, setRestored] = useState(false);
  const discardDraft = useCallback(() => { removeStored("session", draftKey); removeStored("session", anchorKey); setRestored(false); }, [draftKey, anchorKey]);
  useEffect(() => { if (selection.chosen) writeStored("session", anchorKey, JSON.stringify(selection.chosen)); }, [selection.chosen, anchorKey]);
  // Taken (and forgotten) as soon as a signed-in reader's first reading arrives, whether or not they
  // may comment now, so it cannot open a composer later, unasked; an anonymous reader's stays for their sign-in.
  const keptSignIn = useRef<ReturnType<typeof parseSignIn> | undefined>(undefined);
  useEffect(() => {
    if (!result || result.callerUserId === null || keptSignIn.current !== undefined) return;
    const kept = parseSignIn(readStored("session", signInKey));
    removeStored("session", signInKey);
    // Only a reader who may comment on the reading they came back to has it restored.
    keptSignIn.current = canComment ? kept : null;
  }, [result, canComment, signInKey]);
  const restoreChecked = useRef(false);
  useEffect(() => {
    if (restoreChecked.current || !result || !canComment) return;
    restoreChecked.current = true;
    const anchor = parseStoredAnchor(readStored("session", anchorKey));
    const signedIn = keptSignIn.current;
    if (anchor && readStored("session", draftKey)?.trim()) { selection.choose(anchor); setRestored(true); setOpen(true); return; }
    discardDraft();
    // Back from signing in: the composer opens on the passage, if it is still there as it was; if not, nothing is said.
    const root = readingRef.current?.querySelector<HTMLElement>("[data-review-document]");
    if (signedIn && signedIn.revisionId === revisionId && root && createReviewRangeResolver(root, markdown)(signedIn.anchor)) { selection.choose(signedIn.anchor); setOpen(true); }
  }, [result, canComment, anchorKey, draftKey, revisionId, markdown, selection, discardDraft, setOpen]);
  // ⌘⌥M / Ctrl+Alt+M does what the bubble's Comment does, for a reader who may comment. An anonymous
  // reader's bubble offers sign-in; the key never takes them off the page, so for them it does nothing.
  const commentOnSelection = useCallback(() => { selection.capture(); changeOpen(true); }, [selection.capture, changeOpen]);
  useCommentShortcut(readingRef, canComment, commentOnSelection);
  // The link a reader passes on to a discussion: this page's own (`/s/<token>`), or — read in the Hub, where
  // only a NAMED share is — the `/open` form, which sends each recipient to their own Hub reader.
  const linkTo = useCallback((threadId: string) => new URL(shareDiscussionLink(token, threadId, { documentId, named: window.location.pathname !== sharedPagePath(token) }), window.location.origin).href, [token, documentId]);
  // Only a signed-in reader who may write is offered `@`: the candidate route refuses anyone else.
  const mentionScope = result?.writesEnabled && !anonymous ? scope : undefined;
  const composer = selection.chosen && <ReviewComposer anchor={selection.chosen} signInHref={signInHref} draftKey={draftKey} restored={restored} mentionScope={mentionScope} onCancel={() => { discardDraft(); selection.clear(); }} onSubmit={async (body, idempotencyKey, mentions) => {
    const created = await reviewRequest<{ id: string }>("/api/share-review/threads", { ...scope, expectedRevisionId: revisionId, anchor: selection.chosen, body, idempotencyKey, ...(mentions.length ? { mentions } : {}) });
    discardDraft(); selection.clear(); setFilter(current => current === "RESOLVED" ? "OPEN" : current); setShow(current => current === "MENTIONS" ? "ANYONE" : current); setActiveThreadId(created.id); await load();
  }} />;
  // Beside its passage where the discussions are a rail; at the top of the drawer, which covers the passage, where they are not.
  const draft = composer && inline && !revisionChanged ? { anchor: selection.chosen!, composer } : undefined;
  // What the notice asks for, offered beside it: a reload reads the document as it is now, and an
  // unsent comment or reply is kept across it (2026-10-21 amendment).
  const changedNotice = () => <>
    <p role="status" className="text-body-sm">Document changed. Refresh this page before selecting or locating a passage. You can still reply to existing comments.</p>
    <Button type="button" variant="soft" className="mt-2" onClick={() => window.location.reload()}><RefreshCw className="size-4" aria-hidden="true" />Refresh page</Button>
  </>;
  return <>
    <div className={`sticky top-0 z-20 border-b border-kh-border bg-kh-bg ${wide ? "kh-share-folder-bar" : ""}`}>
      <div className={wide ? "flex h-14 items-center gap-2 px-4" : "kh-review-entry kh-reading-column relative flex min-h-14 items-center justify-between gap-3 py-2"}>
        {brand}
        {/* -me-3 takes back the last button's padding, so its label ends on the column's edge as the brand starts on it.
            ml-auto keeps the actions on the right where there is no brand (the Hub's reader), so they stay put when the rail opens. */}
        <div className={wide ? "-me-3 ml-auto flex shrink-0 items-center gap-1" : "-me-3 ml-auto flex min-w-0 items-center justify-end gap-1"}>
          <span aria-live="polite">{arrived && <Button type="button" variant="soft" onClick={showArrived} className="kh-pop-in max-sm:px-2"><span className="max-sm:hidden">{arrived.count === 1 ? "1 new comment" : `${arrived.count} new comments`}</span><span className="sm:hidden">{arrived.count} new</span></Button>}</span>
          <Button ref={entryRef} type="button" variant="ghost" aria-label={`${open ? "Hide comments" : "Show comments"}${result ? `, ${result.threads.length} comments` : ""}${allResolved ? ", all resolved" : openCount > 0 ? `, ${openCount} open` : ""}`} aria-expanded={open} aria-controls="shared-document-discussions" onPointerDown={event => event.preventDefault()} onClick={toggle} className="max-sm:gap-1 max-sm:px-2">
            <MessageSquare className="size-4" aria-hidden="true" />
            {/* The number is what still wants an answer, as the owner's entry counts; the name says both. */}
            <span className="max-sm:sr-only">Comments{allResolved ? ` · ${result.threads.length} resolved` : openCount > 0 ? ` (${openCount})` : ""}</span>
            {openCount > 0 ? <span className="tabular-nums sm:hidden">{openCount}</span> : null}
          </Button>
          {actions}
        </div>
      </div>
    </div>
    {!open && (error || revisionChanged) && <div className="kh-reading-column py-3">
      {error && <p role="status" className="text-body-sm">{error} <Button type="button" variant="ghost" aria-label="Refresh comments" onClick={() => void load()}><RefreshCw className="size-4" aria-hidden="true" />Retry</Button></p>}
      {revisionChanged && changedNotice()}
    </div>}
    <div className="kh-review-document" data-review-ready={result || error ? "" : undefined} data-review-open={open ? "" : undefined} data-review-inline={inline ? "" : undefined}>
      <div ref={readingRef} className="kh-review-reading">
        {children}
        {canComment && <ReviewSelectionBubble place={selection.place} ready={selection.ready} hint={selection.hint} onComment={commentOnSelection} />}
        {/* The keyboard's way in: read-only text cannot be selected without a pointer, so each paragraph
            has the owner's Comment button, offered only to a reader who may write. What is selected
            inside the paragraph narrows it, as on the owner's page. */}
        {canComment && <ReviewBlockComment readingRef={readingRef} markdown={markdown} chosen={selection.chosen} onChoose={(anchor, element) => {
          holdAt(element);
          const root = readingRef.current?.querySelector<HTMLElement>("[data-review-document]");
          const resolved = (root && selectionAnchorInBlock(root, markdown, anchor, window.getSelection())) ?? anchor;
          selection.choose(resolved);
          changeOpen(true);
          return resolved === anchor;
        }} />}
        {anonymous && !revisionChanged && <ReviewSelectionBubble place={selection.place} ready={selection.ready} signInHref={signInHref} onComment={() => {
          const anchor = selection.peek();
          if (anchor) writeStored("session", signInKey, JSON.stringify({ revisionId, anchor }));
        }} />}
        <ReviewPassageMarkers readingRef={readingRef} markdown={markdown} threads={drawn} />
      </div>
      <aside id="shared-document-discussions" className="kh-review-panel" aria-label="Document comments" onKeyDown={event => { if (!event.defaultPrevented && event.key === "Escape" && reviewRailInline()) changeOpen(false); }}>
    <ReviewPanelShell open={open} inline={inline} onOpenChange={changeOpen} returnFocus={() => {
      if (focusArticleAfterClose.current) {
        focusArticleAfterClose.current = false;
        readingRef.current?.querySelector<HTMLElement>("[data-review-document]")?.focus({ preventScroll: true });
        return;
      }
      entryRef.current?.focus({ preventScroll: true });
    }}><div>
      <div className="kh-review-toolbar">
      {/* One row, as the owner's rail has: what this is and which of it is listed, then what acts
          on it. As a drawer the drawer names itself and closes itself, so the name and the cross
          are the rail's alone. */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1"><h2 className="kh-review-rail-only text-body font-medium">Comments</h2>{result && result.threads.length > 0 && <ReviewFilterMenu value={filter} onChange={setFilter} show={show} shows={anonymous ? undefined : SHOWS} onShowChange={setShow} />}</div>
        <div className="flex shrink-0 items-center gap-1"><Tooltip label="Refresh comments"><Button type="button" variant="ghost" icon aria-label="Refresh comments" disabled={refreshing} onClick={() => void load()}><RefreshCw className={`size-4 ${refreshing ? "motion-safe:animate-spin" : ""}`} aria-hidden="true" /></Button></Tooltip><span className="kh-review-rail-only"><Tooltip label="Close comments"><Button type="button" variant="ghost" icon aria-label="Close comments" onClick={() => changeOpen(false)}><X className="size-4" aria-hidden="true" /></Button></Tooltip></span></div>
      </div>
      {result && result.threads.length > 0 && <ReviewNextButtons threads={result.threads} activeThreadId={activeThreadId} onActivate={setActiveThreadId} filter={filter} onFilterChange={setFilter} show={show} onShowChange={setShow} />}
      {error && <div className="mt-3"><p role="status" className="text-body-sm">{error}</p><Button type="button" variant="ghost" className="-ml-3" disabled={refreshing} onClick={() => void load()}><RefreshCw className="size-4" aria-hidden="true" />Retry</Button></div>}
      {!result && !error && <p role="status" className="mt-3 text-body-sm text-kh-text-muted">Loading comments…</p>}
      {refreshing && <p role="status" className="mt-3 text-caption text-kh-text-muted">Updating…</p>}
      {selection.refusal && <p role="status" className="mt-3 text-body-sm">{selection.refusal}</p>}
      {result && <div className="mt-3">
        {revisionChanged && <div className="mb-3">{changedNotice()}</div>}
        {/* The one thing a reader does here that an owner does not, on a row of its own. */}
        {canComment && <div className="mb-3"><CommentShortcutTip inline={inline}><Button type="button" variant="soft" aria-keyshortcuts={inline ? COMMENT_SHORTCUT : undefined} onPointerDown={event => event.preventDefault()} onClick={() => { if (!inline) { focusArticleAfterClose.current = true; changeOpen(false); return; } selection.capture(); }}><MessageSquarePlus className="size-4" aria-hidden="true" />{inline ? "Comment on selected text" : "Close comments and select text"}</Button></CommentShortcutTip>{inline && !selection.ready && <p className="mt-1 text-caption text-kh-text-muted">{COMMENT_HINT}</p>}</div>}
        {/* An anonymous reader is offered sign-in once, as the button below, not also as a line saying the same. */}
        {!result.writesEnabled && !anonymous && <p className="mb-3 text-body-sm text-kh-text-muted">Adding comments is currently disabled.</p>}
        {anonymous && <div className="mb-3"><a href={signInHref} className={buttonClasses({ variant: "soft" })}><LogIn className="size-4" aria-hidden="true" />Sign in to comment</a></div>}
      </div>}
      </div>
      {!draft && composer}
      {result && <ReviewThreadList linkTo={linkTo} draft={draft} filter={filter} onFilterChange={setFilter} show={show} onShowChange={setShow} railMarkdown={revisionChanged ? undefined : markdown} activeThreadId={activeThreadId} onActivate={setActiveThreadId} focusAnchor={revisionChanged ? undefined : anchor => { const root = document.querySelector<HTMLElement>("[data-review-document]"); if (root) focusReviewAnchor(root, markdown, anchor); }} threads={result.threads} writesEnabled={result.writesEnabled} signInHref={anonymous ? signInHref : undefined} reauthHref={anonymous ? undefined : signInHref}
        follow={anonymous ? undefined : async (threadId, next) => { await reviewRequest(`/api/share-review/threads/${threadId}/follow`, { ...scope, following: next }); await load(); }} mentionScope={mentionScope} reply={async (threadId, body, idempotencyKey, mentions) => { await reviewRequest(`/api/share-review/threads/${threadId}/replies`, { ...scope, body, idempotencyKey, ...(mentions.length ? { mentions } : {}) }); await load(); }}
        author={result.callerUserId === null ? undefined : {
          edit: async (threadId, commentId, body) => { await reviewRequest(`/api/share-review/threads/${threadId}/comments/${commentId}/body`, { ...scope, body }); await load(); },
          remove: async (threadId, commentId) => { await reviewRequest(`/api/share-review/threads/${threadId}/comments/${commentId}/deletion`, scope); await load(); },
        }} />}
    </div></ReviewPanelShell>
      </aside>
    </div>
  </>;
}

/** A passage kept across signing in, with the revision it was chosen in; anything else is nothing. */
function parseSignIn(stored: string | null): { revisionId: string; anchor: ReviewAnchor } | null {
  try {
    const value = JSON.parse(stored ?? "") as { revisionId?: unknown; anchor?: unknown } | null;
    const anchor = parseStoredAnchor(JSON.stringify(value?.anchor ?? null));
    return value && typeof value.revisionId === "string" && anchor ? { revisionId: value.revisionId, anchor } : null;
  } catch {
    return null;
  }
}

/** A kept passage, read back as the anchor it was; anything else is no draft. The service checks it again on send. */
function parseStoredAnchor(stored: string | null): ReviewAnchor | null {
  try {
    const value = JSON.parse(stored ?? "") as Partial<ReviewAnchor> | null;
    return value && typeof value.exact === "string" && Array.isArray(value.blockPath) ? value as ReviewAnchor : null;
  } catch {
    return null;
  }
}
