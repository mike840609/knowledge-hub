"use client";

import dynamic from "next/dynamic";
import { PersistentDraft, type DraftStatus } from "@/lib/persistent-draft";
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
import { MarkdownArticle } from "./markdown-article";
import type { MarkdownEditor } from "./editor/editor-core";
import type { RenderedEditorProps } from "./editor/rendered-editor";
import { useFormKeys } from "./use-form-keys";

// Its code failing to load (offline, or replaced by a deploy) is a failed editor, not a broken page.
function EditorUnavailable({ onFail }: RenderedEditorProps) {
  useEffect(() => onFail(), [onFail]);
  return null;
}

// Loaded on demand and never on the server: Milkdown and ProseMirror stay out of the first bundle.
const RenderedEditor = dynamic(
  () => import("./editor/rendered-editor").then((module) => module.RenderedEditor, () => EditorUnavailable),
  { ssr: false },
);

type Mode = "rendered" | "source";
type Content = { markdown: string; title: string };

/** How long a successful save waits for the client navigation before a full load. */
const ARRIVAL_GRACE_MS = 3_000;

function fitHeight(textarea: HTMLTextAreaElement) {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

export type ComposerSubmit = { title: string; markdown: string; expectedRevisionId: string | null };

/**
 * Writing a document, laid out like reading one (composer spec). The header row
 * is the reader's with the actions swapped; the column is the reader's with the
 * article swapped for an editor: the rendered document by default, its Markdown
 * source on request (spec §11). `markdown` is the only state either edits.
 * Everything that decides something lives in `lib/`: the title in
 * `authored-title`, the draft in `document-draft`, the keys in `form-keys`.
 */
export function DocumentComposer({
  workspaceId,
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
  /** Where `[[` looks for documents to link to. */
  workspaceId: string;
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
  const { confirmed, access } = useWorkspaceAuthorization();
  const [draftStatus, setDraftStatus] = useState<DraftStatus>("loading");
  const persistent = useRef<PersistentDraft | null>(null);
  // A new document started from a broken link's title keeps its draft in the tab, not the account: the
  // account holds one blank "new" draft per workspace (`draft:new`, the only key the server accepts for it),
  // and a second document under that key would restore the wrong text or overwrite the blank one's.
  const seeded = draftKey.kind === "new" && draftKey.title !== undefined;
  const durableDraft = access.workspace.type === "PERSONAL" && !seeded;
  // Everything waits for hydration; see `use-hydrated` for what a native submit costs.
  const hydrated = useHydrated();
  const [title, setTitle] = useState(initialTitle);
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [baseRevisionId, setBaseRevisionId] = useState(currentRevisionId);
  const [restored, setRestored] = useState<"current" | "stale" | null>(null);
  const [restoreChecked, setRestoreChecked] = useState(false);
  const [mode, setMode] = useState<Mode>("rendered");
  // A change made in the rendered editor. Counts as a modification at once, before its output arrives.
  const [touched, setTouched] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  const [editorFailed, setEditorFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GovernanceFailure | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<MarkdownEditor | null>(null);
  // The Markdown the rendered editor last showed or produced; if `markdown` differs, the editor is out of date.
  const syncedRef = useRef(initialMarkdown);
  // Typed into the editor and not yet delivered as Markdown (its output is debounced).
  const pendingRef = useRef(false);
  // `markdown` and `title` as last set, ahead of the render that shows them: the editor's output is
  // set from a timer and rendered a task later, and a Save handled in between runs the old closures.
  const latestRef = useRef<Content>({ markdown: initialMarkdown, title: initialTitle });
  const restoreTried = useRef(false);
  // The surface focus was last given to (null until the first focus), and whether a focus had to wait for its surface.
  const focusedMode = useRef<Mode | null>(null);
  const focusWaited = useRef(false);
  const leaving = useRef(false);
  const arrivalGuard = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(arrivalGuard.current), []);

  // A failed editor leaves the Markdown source, which always works.
  const showing: Mode = editorFailed ? "source" : mode;
  const resolved = resolveAuthoredTitle({ metadataTitle, markdown, typedTitle: title });
  const dirty = title !== initialTitle || markdown !== initialMarkdown || touched;
  // Fields wait for the restore check too: enabling them the instant
  // hydration commits, before sessionStorage has been read, lets a keystroke
  // land in the gap and then be overwritten by a draft arriving a tick later.
  const interactive = hydrated && restoreChecked && !busy && !blocked;
  // Rendered editing also waits for its editor: a title field that is editable
  // before Save can act would let ⌘Enter do nothing.
  const ready = interactive && (showing === "source" || editorReady);
  // The Markdown text takes typing once the editor has loaded, or failed and left the source in charge (spec §11.5).
  const sourceReady = editorReady || editorFailed;
  const mountEditor = hydrated && restoreChecked && !editorFailed;
  const initial = { title: initialTitle, markdown: initialMarkdown };

  // Once, after hydration: the server has no sessionStorage, and anything set
  // before hydration commits is overwritten by the server's values.
  useEffect(() => {
    if (!hydrated || restoreTried.current) return;
    restoreTried.current = true;
    const remote = durableDraft
      ? new PersistentDraft(`/api/workspaces/${access.workspace.id}/personal`, draftKey.kind === "new" ? "draft:new" : `draft:${draftKey.documentId}`, setDraftStatus)
      : null;
    persistent.current = remote;
    let live = true;
    const restore = async () => {
      const draft = remote ? await remote.load() : readDraft(browserDraftStorage(), draftKey);
      if (!live) return;
      if (draft) {
        setContent({ markdown: draft.markdown, title: draft.title });
        setBaseRevisionId(draft.baseRevisionId);
        setRestored(draft.baseRevisionId === currentRevisionId ? "current" : "stale");
      }
      setRestoreChecked(true);
    };
    void restore();
    return () => { live = false; restoreTried.current = false; remote?.dispose(); };
  }, [hydrated, currentRevisionId, access.workspace.id, access.workspace.type]);

  // Warn while text has not reached durable account storage. Legacy Team drafts
  // remain tab-scoped and therefore still warn before leaving.
  useEffect(() => {
    if (!dirty || (persistent.current && draftStatus === "saved")) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (!leaving.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, draftStatus]);

  // First focus: an empty title field when one is shown, else the start of the
  // text. Later: the surface a mode switch shows. Each waits until its surface can
  // take it (an editor still loading, a Markdown text not yet enabled). A focus
  // that had to wait is dropped if the person has meanwhile put the caret in a
  // field themselves: the editor arriving must not take it from them.
  useEffect(() => {
    if (!hydrated || !restoreChecked || focusedMode.current === showing) return;
    const rendered = showing === "rendered";
    if (rendered ? !editorReady : !sourceReady) {
      focusWaited.current = true;
      return;
    }
    const first = focusedMode.current === null;
    focusedMode.current = showing;
    const active = document.activeElement;
    const movedOn = focusWaited.current && active instanceof HTMLElement && (active.matches("input, textarea") || active.isContentEditable);
    focusWaited.current = false;
    if (movedOn) return;
    if (first && titleRef.current && !titleRef.current.value) {
      titleRef.current.focus();
      return;
    }
    if (rendered) {
      if (first) editorRef.current?.focusStart();
      else editorRef.current?.focus();
      return;
    }
    const textarea = textareaRef.current;
    textarea?.focus();
    if (first) textarea?.setSelectionRange(0, 0);
  }, [hydrated, restoreChecked, showing, editorReady, sourceReady]);

  // The Markdown text grows with its content, so the page scrolls, not a box inside it.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea && showing === "source") fitHeight(textarea);
  }, [markdown, showing]);

  // Rewrapping changes the height too — a narrower window, a web font that
  // arrives after first layout. The textarea hides its overflow, so without
  // this the lines past the old height are clipped until the next keystroke.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || showing !== "source") return;
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
  }, [showing]);

  // Anything that changed `markdown` from outside the rendered editor (a
  // discarded draft landing while the editor was still loading, or an edit made
  // in the source) reaches the editor here. Not while the person has
  // typed something the editor has not delivered yet. Markdown the editor makes
  // nothing of leaves the source in charge, as it does on opening (spec §11.5).
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !editorReady || showing !== "rendered" || pendingRef.current) return;
    if (markdown === syncedRef.current) return;
    try {
      editor.replaceMarkdown(markdown);
      syncedRef.current = markdown;
    } catch {
      handleEditorFail();
    }
  }, [markdown, showing, editorReady]);

  function keep(nextTitle: string, nextMarkdown: string) {
    // Cancel and load-latest leave the fields editable while the page navigates; a keystroke there must not write back the draft they just cleared.
    if (leaving.current) return;
    if (persistent.current) {
      persistent.current.change(nextTitle === initialTitle && nextMarkdown === initialMarkdown ? null : { title: nextTitle, markdown: nextMarkdown, baseRevisionId });
    } else syncDraft(browserDraftStorage(), draftKey, { title: nextTitle, markdown: nextMarkdown, baseRevisionId }, initial);
  }

  function setContent(next: Content) {
    latestRef.current = next;
    setMarkdown(next.markdown);
    setTitle(next.title);
  }

  function applyMarkdown(next: string): Content {
    const current = latestRef.current;
    const before = resolveAuthoredTitle({ metadataTitle, markdown: current.markdown, typedTitle: current.title });
    const after = resolveAuthoredTitle({ metadataTitle, markdown: next, typedTitle: current.title });
    const content = { markdown: next, title: carryTitle(before, after, current.title) };
    setContent(content);
    keep(content.title, content.markdown);
    return content;
  }

  function changeTitle(next: string) {
    setContent({ ...latestRef.current, title: next });
    keep(next, latestRef.current.markdown);
  }

  // The rendered editor's output becomes `markdown`.
  function adopt(next: string): Content {
    syncedRef.current = next;
    pendingRef.current = false;
    if (next === initialMarkdown) setTouched(false);
    return next === latestRef.current.markdown ? latestRef.current : applyMarkdown(next);
  }

  // Brings `markdown` up to date with what was typed, now rather than after the debounce.
  function flush(): Content {
    const editor = editorRef.current;
    if (leaving.current || !editor || !pendingRef.current) return latestRef.current;
    return adopt(editor.getMarkdown());
  }

  // `openedWith` is what the editor shows. If `markdown` moved on while it was
  // loading, the effect above sees the difference and brings it up to date.
  function handleEditorReady(editor: MarkdownEditor, openedWith: string) {
    editorRef.current = editor;
    syncedRef.current = openedWith;
    setEditorReady(true);
  }

  function handleEditorFail() {
    editorRef.current = null;
    pendingRef.current = false;
    setEditorReady(false);
    setEditorFailed(true);
  }

  function handleUserEdit() {
    pendingRef.current = true;
    setTouched(true);
  }

  // The editor's output only means something while the rendered view is the one
  // being edited. After a mode switch everything typed was already delivered by
  // `flush`, and a debounce firing late would overwrite what is being typed in
  // the source. Once leaving has begun (Cancel, load the latest version) the
  // draft is already cleared, and a late emission would write it back.
  function handleEditorMarkdown(next: string) {
    if (leaving.current || showing !== "rendered") return;
    adopt(next);
  }

  function discardDraft() {
    void persistent.current?.clear();
    clearDraft(browserDraftStorage(), draftKey);
    pendingRef.current = false;
    setTouched(false);
    setContent({ markdown: initialMarkdown, title: initialTitle });
    setBaseRevisionId(currentRevisionId);
    setRestored(null);
  }

  function cancel() {
    if (dirty && !window.confirm("Discard changes?")) return;
    pendingRef.current = false;
    void persistent.current?.clear();
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
    void persistent.current?.clear();
    clearDraft(browserDraftStorage(), draftKey);
    leaving.current = true;
    window.location.assign(conflictHref);
  }

  async function save() {
    if (busy || !confirmed || !ready) return;
    // What was typed a moment ago has not reached `markdown` yet; save what is there.
    const snapshot = flush();
    const final = resolveAuthoredTitle({ metadataTitle, markdown: snapshot.markdown, typedTitle: snapshot.title });
    if (!final.title) return;
    setBusy(true);
    setError(null);
    try {
      const href = await onSubmit({ title: final.title, markdown: snapshot.markdown, expectedRevisionId: baseRevisionId });
      await persistent.current?.clear();
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

  function toggleMode() {
    if (editorFailed) return;
    // Going to the source: what is in the editor becomes `markdown` first.
    // Coming back, the effect above brings the editor up to date.
    if (showing === "rendered") flush();
    setMode(showing === "rendered" ? "source" : "rendered");
  }

  // Typed text is kept as a draft even if the tab is hidden or closed within the
  // debounce. The editor may already be gone when this runs on unmount.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const persist = () => {
      try {
        flushRef.current();
      } catch {
        // The editor was destroyed first; its last delivered output was already kept.
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") persist();
    };
    window.addEventListener("pagehide", persist);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", persist);
      document.removeEventListener("visibilitychange", onVisibility);
      persist();
    };
  }, []);

  const onKeyDown = useFormKeys({ dirty, busy, onCancel: cancel, mode: { toggle: toggleMode } });

  // Plain Enter in a single-line title field would otherwise submit the form
  // natively; ⌘/Ctrl Enter still reaches useFormKeys's save handling above.
  function onTitleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.metaKey || event.ctrlKey) return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (showing === "rendered") editorRef.current?.focusStart();
    else textareaRef.current?.focus();
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
                aria-pressed={showing === "source"}
                aria-keyshortcuts="Meta+/ Control+/"
                title={editorFailed ? "Rendered editing is not available for this document" : "Show Markdown source (⌘/)"}
                className="aria-pressed:bg-kh-bg-selected aria-pressed:text-kh-text"
                disabled={!hydrated || editorFailed}
                onClick={toggleMode}
              >
                Markdown
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
          {durableDraft && <p role="status" className="text-caption text-kh-text-muted">
            {({ loading: "Loading draft…", saved: "Draft saved to your account", saving: "Saving draft…", local: "Draft kept on this device · syncing…", error: "Draft sync failed. Keep this page open and retry.", conflict: "Draft changed on another device. Your text is preserved here; copy it before loading another draft." })[draftStatus]}
            {draftStatus === "error" && <Button type="button" variant="link" onClick={() => void persistent.current?.retry()}>Retry draft save</Button>}
          </p>}
          {restored ? (
            <p role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-kh-border bg-kh-bg-subtle px-3 py-2 text-body text-kh-text">
              {restored === "stale" ? "這份文件在你離開後被更新過，已還原你未存的修改。" : "已還原未存的修改。"}
              <Button type="button" variant="link" onClick={discardDraft}>捨棄</Button>
            </p>
          ) : null}
          {editorFailed ? (
            <p role="status" className="rounded-md border border-kh-border bg-kh-bg-subtle px-3 py-2 text-body text-kh-text">
              這份文件的排版無法在渲染模式下編輯，已改用 Markdown 模式。
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
              onChange={(event) => changeTitle(event.target.value)}
              onKeyDown={onTitleKeyDown}
              className="w-full border-0 bg-transparent p-0 text-heading font-semibold tracking-tight text-kh-text outline-none placeholder:text-kh-text-muted"
            />
          ) : null}
          {/* The reader's rule: a title above the content unless the content opens with its own heading.
              TYPED has the title field above; METADATA has neither. */}
          {showing === "rendered" && resolved.source === "METADATA" && !markdownOpensWithHeading(markdown) ? (
            <h1 className="text-heading font-semibold tracking-tight text-kh-text">{resolved.title}</h1>
          ) : null}
          {/* Until the editor is ready the reader's own rendering stands in for it, so nothing flashes. */}
          {showing === "rendered" && !editorReady ? <MarkdownArticle markdown={markdown} /> : null}
          {mountEditor ? (
            <div hidden={showing !== "rendered" || !editorReady}>
              <RenderedEditor
                workspaceId={workspaceId}
                documentId={draftKey.kind === "edit" ? draftKey.documentId : undefined}
                markdown={markdown}
                editable={interactive}
                onReady={handleEditorReady}
                onFail={handleEditorFail}
                onUserEdit={handleUserEdit}
                onMarkdown={handleEditorMarkdown}
              />
            </div>
          ) : null}
          {/* No display utility here: it would override [hidden]. */}
          <textarea
            ref={textareaRef}
            aria-label="Markdown"
            placeholder="Write in Markdown. Start with # to name the document."
            value={markdown}
            disabled={!interactive || !sourceReady}
            hidden={showing !== "source"}
            onChange={(event) => applyMarkdown(event.target.value)}
            className="min-h-[12rem] w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-reading text-kh-text outline-none placeholder:text-kh-text-muted"
          />
        </div>
      </form>
      {footer ? <div className="kh-reading-column pb-6">{footer({ busy })}</div> : null}
    </>
  );
}
