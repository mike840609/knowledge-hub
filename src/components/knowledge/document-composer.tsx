"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/shell/use-hydrated";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { refreshOnArrival } from "@/components/shell/refresh-on-arrival";
import { GovernanceError, governanceFailure, type GovernanceFailure } from "@/components/workspaces/governance-error";
import { carryTitle, resolveAuthoredTitle } from "@/lib/authored-title";
import { browserDraftStorage, clearDraft, readDraft, syncDraft, type DraftKey } from "@/lib/document-draft";
import { markdownOpensWithHeading } from "@/lib/markdown-title";
import { DocumentBreadcrumb, type DocumentBreadcrumbSegment } from "./document-breadcrumb";
import { MarkdownArticle } from "./document-viewer";
import { useFormKeys } from "./use-form-keys";

/** How long a successful save waits for the client navigation before a full load. */
const ARRIVAL_GRACE_MS = 3_000;

function fitHeight(textarea: HTMLTextAreaElement) {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

export type ComposerSubmit ={ title: string; markdown: string; expectedRevisionId: string | null };

/**
 * Writing a document, laid out like reading one (composer spec). The header row
 * is the reader's with the actions swapped; the column is the reader's with the
 * article swapped for its source. Everything that decides something lives in
 * `lib/`: the title in `authored-title`, the draft in `document-draft`, the keys
 * in `form-keys`.
 */
export function DocumentComposer({
  draftKey,
  location,
  untitledLabel,
  metadataTitle,
  initialTitle,
  initialMarkdown,
  currentRevisionId,
  submitLabel,
  cancelHref,
  onSubmit,
  conflictHref,
  blocked,
  footer,
}: {
  draftKey: DraftKey;
  /** Breadcrumb up to, not including, the document; the resolved title is appended. */
  location: DocumentBreadcrumbSegment[];
  /** The last breadcrumb segment while nothing supplies a title. */
  untitledLabel: string;
  metadataTitle: unknown;
  initialTitle: string;
  initialMarkdown: string;
  /** The revision this editor opened on; null when creating. */
  currentRevisionId: string | null;
  submitLabel: string;
  cancelHref: string;
  /** Sends the document and returns where it now lives; throws on refusal. */
  onSubmit: (input: ComposerSubmit) => Promise<string>;
  /** Where "load the latest version" goes after a conflict; null when creating. */
  conflictHref: string | null;
  /** Another operation owns the page, e.g. an upload; nothing here may start. */
  blocked?: boolean;
  footer?: (state: { busy: boolean }) => ReactNode;
}) {
  const router = useRouter();
  const { confirmed } = useWorkspaceAuthorization();
  // Everything waits for hydration; see `use-hydrated` for what a native submit costs.
  const hydrated = useHydrated();
  const [title, setTitle] = useState(initialTitle);
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [baseRevisionId, setBaseRevisionId] = useState(currentRevisionId);
  const [restored, setRestored] = useState<"current" | "stale" | null>(null);
  const [restoreChecked, setRestoreChecked] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GovernanceFailure | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const restoreTried = useRef(false);
  const focusedOnce = useRef(false);
  const leaving = useRef(false);
  const arrivalGuard = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(arrivalGuard.current), []);

  const resolved = resolveAuthoredTitle({ metadataTitle, markdown, typedTitle: title });
  const dirty = title !== initialTitle || markdown !== initialMarkdown;
  // Fields wait for the restore check too: enabling them the instant
  // hydration commits, before sessionStorage has been read, lets a keystroke
  // land in the gap and then be overwritten by a draft arriving a tick later.
  const ready = hydrated && restoreChecked && !busy && !blocked;
  const initial = { title: initialTitle, markdown: initialMarkdown };

  // Once, after hydration: the server has no sessionStorage, and anything set
  // before hydration commits is overwritten by the server's values.
  useEffect(() => {
    if (!hydrated || restoreTried.current) return;
    restoreTried.current = true;
    const draft = readDraft(browserDraftStorage(), draftKey);
    if (draft) {
      setTitle(draft.title);
      setMarkdown(draft.markdown);
      setBaseRevisionId(draft.baseRevisionId);
      setRestored(draft.baseRevisionId === currentRevisionId ? "current" : "stale");
    }
    setRestoreChecked(true);
  }, [hydrated, draftKey, currentRevisionId]);

  // Closing the tab loses sessionStorage; reloading does not, but the browser
  // cannot tell the two apart, so both ask.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (!leaving.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // First focus: an empty title field when one is shown, else the start of the
  // text. Later: whichever of text and preview is showing. A hidden textarea
  // keeps its selection, so returning to it puts the caret back where it was.
  useEffect(() => {
    // Also wait for the restore check: focusing while fields are still
    // disabled (restore pending) is a no-op, and this effect's deps did not
    // used to include restoreChecked, so it never ran again once that flag
    // flipped and the fields actually became usable.
    if (!hydrated || !restoreChecked) return;
    if (previewing) {
      previewRef.current?.focus();
      return;
    }
    const textarea = textareaRef.current;
    if (focusedOnce.current) {
      textarea?.focus();
      return;
    }
    focusedOnce.current = true;
    if (titleRef.current && !titleRef.current.value) {
      titleRef.current.focus();
      return;
    }
    textarea?.focus();
    textarea?.setSelectionRange(0, 0);
  }, [hydrated, restoreChecked, previewing]);

  // The text grows with its content, so the page scrolls, not a box inside it.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea && !previewing) fitHeight(textarea);
  }, [markdown, previewing]);

  // Rewrapping changes the height too — a narrower window, a web font that
  // arrives after first layout. The textarea hides its overflow, so without
  // this the lines past the old height are clipped until the next keystroke.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || previewing) return;
    let width = textarea.clientWidth;
    const observer = new ResizeObserver(() => {
      if (textarea.clientWidth === width) return;
      width = textarea.clientWidth;
      fitHeight(textarea);
    });
    observer.observe(textarea);
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) fitHeight(textarea);
    });
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [previewing]);

  function keep(nextTitle: string, nextMarkdown: string) {
    syncDraft(browserDraftStorage(), draftKey, { title: nextTitle, markdown: nextMarkdown, baseRevisionId }, initial);
  }

  function changeMarkdown(next: string) {
    const after = resolveAuthoredTitle({ metadataTitle, markdown: next, typedTitle: title });
    const nextTitle = carryTitle(resolved, after, title);
    setMarkdown(next);
    setTitle(nextTitle);
    keep(nextTitle, next);
  }

  function changeTitle(next: string) {
    setTitle(next);
    keep(next, markdown);
  }

  function discardDraft() {
    clearDraft(browserDraftStorage(), draftKey);
    setTitle(initialTitle);
    setMarkdown(initialMarkdown);
    setBaseRevisionId(currentRevisionId);
    setRestored(null);
  }

  function cancel() {
    if (dirty && !window.confirm("Discard changes?")) return;
    clearDraft(browserDraftStorage(), draftKey);
    leaving.current = true;
    leave(cancelHref);
  }

  // The router now and then drops a client navigation from `/edit` back to
  // its document after the response has arrived — measured on main as well,
  // with the old editor (composer verification record). Leaving is already
  // decided when this runs (saved, or discarded), so if this component is
  // still mounted after a grace period, finish with a full load instead of
  // leaving a stranded editor behind. Unmounting on arrival cancels it.
  function leave(href: string) {
    router.push(href);
    arrivalGuard.current = window.setTimeout(() => window.location.assign(href), ARRIVAL_GRACE_MS);
  }

  function loadLatest() {
    if (!conflictHref) return;
    clearDraft(browserDraftStorage(), draftKey);
    leaving.current = true;
    window.location.assign(conflictHref);
  }

  async function save() {
    if (busy || !confirmed || !resolved.title) return;
    setBusy(true);
    setError(null);
    try {
      const href = await onSubmit({ title: resolved.title, markdown, expectedRevisionId: baseRevisionId });
      clearDraft(browserDraftStorage(), draftKey);
      leaving.current = true;
      // Push only, then refresh on arrival: a refresh fired beside the push
      // discards it (keyboard-shortcuts spec §9, #49).
      refreshOnArrival(href);
      leave(href);
    } catch (failure) {
      setError(governanceFailure(failure));
      setBusy(false);
    }
    // No finally: on success the page is navigating away, and re-enabling
    // the fields would let a keystroke land between the PATCH and the
    // navigation, rewriting the draft against a base revision already
    // superseded by the save that just happened.
  }

  const togglePreview = () => setPreviewing((was) => !was);
  const exitPreview = () => setPreviewing(false);
  const onKeyDown = useFormKeys({ dirty, busy, onCancel: cancel, preview: { active: previewing, toggle: togglePreview, exit: exitPreview } });

  // Plain Enter in a single-line title field would otherwise submit the form
  // natively; ⌘/Ctrl Enter still reaches useFormKeys's save handling above.
  function onTitleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.metaKey || event.ctrlKey) return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    textareaRef.current?.focus();
  }
  const conflict = error?.code === "REVISION_CONFLICT";
  const untitled = !resolved.title;

  return (
    <>
      <form onKeyDown={onKeyDown} onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="kh-reading-column pb-3 pt-5">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <DocumentBreadcrumb segments={[...location, { label: resolved.title || untitledLabel }]} />
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                aria-pressed={previewing}
                aria-keyshortcuts="Meta+Shift+P Control+Shift+P"
                title="Preview (⌘⇧P)"
                className="aria-pressed:bg-kh-bg-selected aria-pressed:text-kh-text"
                disabled={!hydrated}
                onClick={togglePreview}
              >
                Preview
              </Button>
              <Button type="button" variant="secondary" title="Cancel (Esc)" disabled={busy || blocked} onClick={cancel}>
                Cancel
              </Button>
              <Button
                type="submit"
                title={untitled ? "Add a title, or start the document with a # heading" : `${submitLabel} (⌘Enter)`}
                disabled={!ready || !confirmed || untitled}
              >
                {submitLabel}
              </Button>
            </div>
          </div>
          {resolved.source === "METADATA" ? (
            <p className="mt-1.5 text-caption text-kh-text-muted">標題來自上傳檔案的 frontmatter</p>
          ) : null}
        </div>
        <div className="kh-reading-column space-y-4 py-6">
          {restored ? (
            <p role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-kh-border bg-kh-bg-subtle px-3 py-2 text-body text-kh-text">
              {restored === "stale" ? "這份文件在你離開後被更新過，已還原你未存的修改。" : "已還原未存的修改。"}
              <Button type="button" variant="link" onClick={discardDraft}>捨棄</Button>
            </p>
          ) : null}
          {conflict ? (
            <div role="alert" className="rounded-md border border-kh-border bg-kh-bg-subtle px-3 py-2 text-body text-kh-text">
              這份文件已被其他人更新。你的輸入仍保留在表單中。
              <Button type="button" variant="link" className="ml-2" onClick={loadLatest}>載入最新版本（捨棄你的修改）</Button>
            </div>
          ) : (
            <GovernanceError error={error} />
          )}
          {resolved.source === "TYPED" ? (
            <input
              ref={titleRef}
              aria-label="Title"
              placeholder="Title"
              value={title}
              maxLength={512}
              disabled={!ready}
              hidden={previewing}
              onChange={(event) => changeTitle(event.target.value)}
              onKeyDown={onTitleKeyDown}
              className="w-full border-0 bg-transparent p-0 text-heading font-semibold tracking-tight text-kh-text outline-none placeholder:text-kh-text-muted"
            />
          ) : null}
          {/* No display utility here: it would override [hidden] (plan Global Constraints). */}
          <textarea
            ref={textareaRef}
            aria-label="Markdown"
            placeholder="Write in Markdown. Start with # to name the document."
            value={markdown}
            disabled={!ready}
            hidden={previewing}
            onChange={(event) => changeMarkdown(event.target.value)}
            className="min-h-[12rem] w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-reading text-kh-text outline-none placeholder:text-kh-text-muted"
          />
          {previewing ? (
            <div ref={previewRef} role="region" aria-label="Preview" tabIndex={-1} className="outline-none">
              {/* The reader's rule: a title above the content unless the content opens with its own heading. */}
              {resolved.title && !markdownOpensWithHeading(markdown) ? (
                <h1 className="mb-4 text-heading font-semibold tracking-tight text-kh-text">{resolved.title}</h1>
              ) : null}
              <MarkdownArticle markdown={markdown} />
            </div>
          ) : null}
        </div>
      </form>
      {footer ? <div className="kh-reading-column pb-6">{footer({ busy })}</div> : null}
    </>
  );
}
