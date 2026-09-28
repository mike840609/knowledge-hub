"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/shell/use-hydrated";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { refreshOnArrival } from "@/components/shell/refresh-on-arrival";
import { GovernanceError, governanceFailure, type GovernanceFailure } from "@/components/workspaces/governance-error";
import { carryTitle, resolveAuthoredTitle } from "@/lib/authored-title";
import { browserDraftStorage, clearDraft, readDraft, syncDraft, type DraftKey } from "@/lib/document-draft";
import { DocumentBreadcrumb, type DocumentBreadcrumbSegment } from "./document-breadcrumb";
import { MarkdownArticle } from "./document-viewer";
import { useFormKeys } from "./use-form-keys";

export type ComposerSubmit = { title: string; markdown: string; expectedRevisionId: string | null };

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
    if (!hydrated) return;
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
  }, [hydrated, previewing]);

  // The text grows with its content, so the page scrolls, not a box inside it.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || previewing) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [markdown, previewing]);

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
    router.push(cancelHref);
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
      router.push(href);
    } catch (failure) {
      setError(governanceFailure(failure));
    } finally {
      setBusy(false);
    }
  }

  const togglePreview = () => setPreviewing((was) => !was);
  const onKeyDown = useFormKeys({ dirty, busy, onCancel: cancel, preview: { active: previewing, toggle: togglePreview } });
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
              {resolved.source === "TYPED" && resolved.title ? (
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
