"use client";

import { useCallback, useEffect, useRef, useState, type ComponentProps, type ComponentType, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { DocumentDetailClient } from "./document-inspector";
import { OwnerReviewPanel } from "./owner-review-panel";
import { AutosaveIndicator } from "./autosave-indicator";
import { ReadRevisionMarker } from "./read-revision-marker";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { governanceFailure, governanceRequest, GovernanceError } from "@/components/workspaces/governance-error";
import { DocumentAutosave, type DocumentContent, type SavedRevision } from "@/lib/document-autosave";
import { browserDraftStorage, clearDraft, readDraft, syncDraft, type DraftKey } from "@/lib/document-draft";
import { PersistentDraft } from "@/lib/persistent-draft";
import { carryTitle, resolveAuthoredTitle } from "@/lib/authored-title";
import { markdownOpensWithHeading } from "@/lib/markdown-title";
import { extractDocumentLinks } from "@/modules/knowledge/domain/document-links";
import type { RenderedLinks } from "./rendered-links";
import type { MarkdownEditor } from "./editor/editor-core";
import type { RenderedEditorProps } from "./editor/rendered-editor";
import type { CaptureReviewAnchor, PreparedReviewComment } from "./inline-review-context";

type DetailProps = Omit<ComponentProps<typeof DocumentDetailClient>, "children" | "titleControl" | "editorActions">;

/** The reader's frame stays mounted while its article edits and saves in place. */
export function EditableDocument({ detail, markdown, metadataTitle, revisionId, userId, personal, standIn, backlinks, links }: {
  detail: DetailProps;
  markdown: string;
  metadataTitle: unknown;
  revisionId: string;
  userId: string;
  personal: boolean;
  standIn: ReactNode;
  backlinks: ReactNode;
  links?: RenderedLinks;
}) {
  const router = useRouter();
  const { confirmed, access } = useWorkspaceAuthorization();
  const [content, setContent] = useState<DocumentContent>({ title: detail.title, markdown });
  const [savedRevision, setSavedRevision] = useState(revisionId);
  const [savedTitle, setSavedTitle] = useState(detail.title);
  const [savedAt, setSavedAt] = useState(detail.updatedAt);
  const [localRevisions, setLocalRevisions] = useState<DetailProps["inspectorData"]["revisions"]>([]);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const metadataDirty = useRef(false);
  const savedLinkTargets = useRef<string | undefined>(undefined);
  savedLinkTargets.current ??= JSON.stringify(extractDocumentLinks(markdown).map(({ kind, target, fragment }) => [kind, target, fragment]));
  const refreshMetadata = useCallback(() => {
    if (!metadataDirty.current) return;
    clearTimeout(refreshTimer.current);
    refreshTimer.current = undefined;
    metadataDirty.current = false;
    window.dispatchEvent(new Event("kh:workspace-mutation"));
    router.refresh();
  }, [router]);
  const [outline, setOutline] = useState(detail.outline);
  const [ready, setReady] = useState(false);
  // A press on the stand-in finishes on the stand-in. Swapping the editor in between its down and up
  // splits them across two elements, and the browser then clicks neither: a link pressed as the page
  // settles would not open. So the editor waits for the release, and for the click it dispatches.
  const standInPressed = useRef(false);
  const revealAfterPress = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [source, setSource] = useState(false);
  const [failed, setFailed] = useState(false);
  const [CodePreview, setCodePreview] = useState<ComponentType<{ code: string; language: string }>>();
  const renderCode = useCallback((code: string, language: string) => CodePreview ? <CodePreview code={code} language={language} /> : <pre><code>{code}</code></pre>, [CodePreview]);
  const sourceTextarea = useRef<HTMLTextAreaElement>(null);
  const [Editor, setEditor] = useState<ComponentType<RenderedEditorProps>>();
  const [recovery, setRecovery] = useState<"current" | "stale" | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [, render] = useState(0);
  const editor = useRef<MarkdownEditor | null>(null);
  const queue = useRef<DocumentAutosave | null>(null);
  const receivedRevision = useRef(revisionId);
  const acknowledgedRevisionNo = useRef(detail.inspectorData.selectedRevisionNo);
  const persistent = useRef<PersistentDraft | null>(null);
  const pending = useRef(false);
  const composing = useRef(false);
  const alive = useRef(false);
  const discardingRef = useRef(false);
  const sourceRef = useRef(false);
  const authorization = useRef(false);
  authorization.current = confirmed && access.actions.canWrite && access.workspace.lifecycleState !== "ARCHIVED";
  const draftKey: DraftKey = { kind: "edit", userId, documentId: detail.inspectorData.documentId };
  const keyRef = useRef(draftKey);
  const resolve = (value: DocumentContent) => resolveAuthoredTitle({ metadataTitle, markdown: value.markdown, typedTitle: value.title });
  const resolved = resolve(content);

  function keepRecovery() {
    const writer = queue.current;
    if (!writer || discardingRef.current) return;
    const draft = writer.dirty ? { ...writer.current, baseRevisionId: writer.revisionId } : null;
    // A tab-local copy also protects personal drafts while the account request is in flight.
    if (draft) syncDraft(browserDraftStorage(), keyRef.current, draft, { title: "\0", markdown: "\0" });
    else clearDraft(browserDraftStorage(), keyRef.current);
    persistent.current?.change(draft, writer.status === "error");
  }
  function change(next: DocumentContent) {
    const writer = queue.current;
    if (!writer) return;
    setContent(next);
    writer.change(next);
    keepRecovery();
  }
  function flushEditor() {
    if (!pending.current || !editor.current || sourceRef.current || discardingRef.current || failed) return;
    const next = editor.current.getMarkdown();
    pending.current = false;
    const previous = queue.current!.current;
    const before = resolve(previous);
    const after = resolve({ ...previous, markdown: next });
    change({ title: carryTitle(before, after, previous.title), markdown: next });
  }
  function prepareComment(capture: CaptureReviewAnchor): PreparedReviewComment {
    flushEditor();
    const writer = queue.current;
    if (!writer || !editable || recovery || source || failed || !ready || composing.current) throw new Error("Finish editing or recovering the document before commenting.");
    const snapshot = writer.current;
    const anchor = capture(snapshot.markdown);
    if (!anchor) throw new Error("Select text within one paragraph to comment.");
    return { anchor, markdown: snapshot.markdown, save: async () => {
      if (writer.error) await writer.retry();
      const revision = await writer.saveCurrent();
      if (writer.current.markdown !== snapshot.markdown || writer.saved.markdown !== snapshot.markdown) throw new Error("The selected text changed. Cancel this comment and select the passage again.");
      return revision;
    } };
  }
  const flushRef = useRef(flushEditor);
  flushRef.current = flushEditor;

  useEffect(() => {
    alive.current = true;
    let live = true;
    let previousStatus: string | undefined;
    const writer = new DocumentAutosave({ title: detail.title, markdown }, revisionId, {
      write: async (snapshot, expectedRevisionId) => {
        if (!authorization.current) throw new Error("Editing is unavailable.");
        const title = resolve(snapshot).title;
        if (!title) throw new Error("Add a title before saving.");
        return governanceRequest<SavedRevision>(`/api/documents/${detail.inspectorData.documentId}`, "PATCH", {
          title, markdown: snapshot.markdown, expectedCurrentRevisionId: expectedRevisionId, autosave: true,
        }, { notifyMutation: false });
      },
      change: () => {
        if (live) render(value => value + 1);
        // A failed document write gets an account recovery copy; normal saves only use local storage.
        if (writer.status === "error" && previousStatus !== "error") void persistent.current?.flush();
        previousStatus = writer.status;
      },
      saved: (snapshot, revision) => {
        keepRecovery();
        // Clear remote recovery only after all current text has reached the document.
        if (!writer.dirty) void persistent.current?.flush();
        if (!live) return;
        acknowledgedRevisionNo.current = revision.revisionNo;
        setSavedRevision(revision.revisionId);
        setSavedTitle(resolve(snapshot).title);
        const createdAt = new Date();
        setSavedAt(createdAt);
        setLocalRevisions(previous => {
          const preserved = revision.preservedRevision;
          const retained = previous.filter(item => item.history?.state !== "WORKING" && item.id !== revision.revisionId && item.id !== preserved?.id);
          if (preserved) retained.push({ ...preserved, createdAt: new Date(preserved.createdAt), history: preserved.history ? { ...preserved.history, windowStartedAt: preserved.history.windowStartedAt ? new Date(preserved.history.windowStartedAt) : null } : undefined });
          return [...retained, { id: revision.revisionId, revisionNo: revision.revisionNo, createdAt, history: revision.history ? { ...revision.history, windowStartedAt: revision.history.windowStartedAt ? new Date(revision.history.windowStartedAt) : null } : undefined }];
        });
        metadataDirty.current = true;
        const targets = JSON.stringify(extractDocumentLinks(snapshot.markdown).map(({ kind, target, fragment }) => [kind, target, fragment]));
        if (targets !== savedLinkTargets.current) {
          savedLinkTargets.current = targets;
          refreshMetadata();
        } else {
          refreshTimer.current ??= setTimeout(refreshMetadata, 30_000);
        }
      },
    });
    writer.pause(true);
    queue.current = writer;
    const remote = personal ? new PersistentDraft(`/api/workspaces/${detail.inspectorData.workspaceId}/personal`, `draft:${detail.inspectorData.documentId}`, () => {}, { autoSync: false, delay: 15_000 }) : null;
    persistent.current = remote;
    void (async () => {
      const local = readDraft(browserDraftStorage(), keyRef.current);
      const account = await remote?.load();
      if (!live) return;
      const draft = local ?? account;
      if (draft && (draft.title !== detail.title || draft.markdown !== markdown)) {
        // Never publish a recovered draft merely because the user opened a page.
        writer.change({ title: draft.title, markdown: draft.markdown });
        setContent(writer.current);
        setRecovery(draft.baseRevisionId === revisionId ? "current" : "stale");
      } else writer.pause(!authorization.current);
      setLoaded(true);
    })();
    const timer = setTimeout(() => { if (live && !editor.current) setFailed(true); }, 15_000);
    void import("./editor/rendered-editor").then(module => {
      if (live) setEditor(() => module.RenderedEditor);
    }).catch(() => { if (live) setFailed(true); });
    const persist = () => {
      try { flushRef.current(); } catch { /* Last serialized recovery copy survives editor teardown. */ }
      keepRecovery();
    };
    const pressEnded = () => {
      standInPressed.current = false;
      if (!revealAfterPress.current) return;
      revealAfterPress.current = false;
      // A mouse release dispatches pointerup, mouseup and click in one task; the next task is after them.
      setTimeout(() => { if (live) setReady(true); }, 0);
    };
    const visibility = () => { if (document.visibilityState === "hidden") persist(); };
    const unload = (event: BeforeUnloadEvent) => {
      persist();
      if (writer.dirty && !discardingRef.current) event.preventDefault();
    };
    window.addEventListener("pagehide", persist);
    window.addEventListener("beforeunload", unload);
    document.addEventListener("visibilitychange", visibility);
    for (const type of ["pointerup", "pointercancel"]) window.addEventListener(type, pressEnded, true);
    // Not captured: a captured blur is any element's, and a press moves focus.
    window.addEventListener("blur", pressEnded);
    return () => {
      persist();
      live = false;
      alive.current = false;
      clearTimeout(timer);
      clearTimeout(refreshTimer.current);
      writer.dispose();
      remote?.dispose();
      window.removeEventListener("pagehide", persist);
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("visibilitychange", visibility);
      for (const type of ["pointerup", "pointercancel"]) window.removeEventListener(type, pressEnded, true);
      window.removeEventListener("blur", pressEnded);
    };
    // A document identity mounts a new component; server refreshes must not reset edits or history.
  }, []);

  useEffect(() => {
    queue.current?.pause(!loaded || !authorization.current || !!recovery || composing.current || !resolved.title);
  }, [loaded, confirmed, access.actions.canWrite, access.workspace.lifecycleState, recovery, resolved.title]);
  useEffect(() => {
    const timer = setTimeout(() => {
      void import("@/shared/markdown/outline").then(({ extractOutline }) => {
        if (!cancelled) setOutline(extractOutline(content.markdown));
      });
    }, 300);
    let cancelled = false;
    return () => { cancelled = true; clearTimeout(timer); };
  }, [content.markdown]);
  // Loading and source-mode changes are the only external replacements. Autosave never replaces DOM.
  useEffect(() => {
    if (ready && !source && editor.current && sourceRef.current) {
      try { editor.current.replaceMarkdown(content.markdown); sourceRef.current = false; }
      catch { setFailed(true); }
    }
  }, [source, ready, content.markdown]);

  useEffect(() => {
    if (!loaded || !queue.current || receivedRevision.current === revisionId) return;
    receivedRevision.current = revisionId;
    if (detail.inspectorData.selectedRevisionNo <= acknowledgedRevisionNo.current) return;
    const writer = queue.current;
    if (!loaded || !writer || writer.revisionId === revisionId || pending.current || composing.current || recovery) return;
    const next = { title: detail.title, markdown };
    if (!writer.adopt(next, revisionId)) return;
    if (editor.current && editor.current.getMarkdown() !== markdown) {
      try { editor.current.replaceMarkdown(markdown); } catch { setFailed(true); }
    }
    setContent(next);
    setSavedTitle(detail.title);
    setSavedAt(detail.updatedAt);
    acknowledgedRevisionNo.current = detail.inspectorData.selectedRevisionNo;
    setSavedRevision(revisionId);
  }, [loaded, revisionId, detail.title, detail.updatedAt, detail.inspectorData.selectedRevisionNo, markdown, recovery]);
  useEffect(() => {
    if (!/```|~~~/u.test(content.markdown) || CodePreview) return;
    let live = true;
    void import("./editor/inline-code-preview").then(module => { if (live) setCodePreview(() => module.InlineCodePreview); }).catch(() => { /* Raw code stays available if its preview cannot load. */ });
    return () => { live = false; };
  }, [content.markdown, CodePreview]);
  useEffect(() => {
    if (!ready || source || failed || !window.location.hash) return;
    const id = decodeURIComponent(window.location.hash.slice(1));
    document.querySelector('[role="region"][aria-label="Document content"]')?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "start" });
  }, [ready, source, failed]);
  useEffect(() => {
    const textarea = sourceTextarea.current;
    if (!textarea) return;
    const fit = () => { textarea.style.height = "auto"; textarea.style.height = `${textarea.scrollHeight}px`; };
    fit();
    let width = textarea.clientWidth;
    const observer = new ResizeObserver(() => {
      if (textarea.clientWidth === width) return;
      width = textarea.clientWidth;
      fit();
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [source, failed, content.markdown]);
  const writer = queue.current;
  const error = writer?.error ? governanceFailure(writer.error) : null;
  const conflict = error?.code === "REVISION_CONFLICT";
  const dirty = !!writer?.dirty || pending.current;
  const editable = loaded && authorization.current;
  const status = !loaded ? "loading" : recovery ? "recovery" : !resolved.title ? "invalid" : error ? "error" : writer?.status === "saving" ? "saving" : dirty ? "pending" : "saved";
  const attention = recovery ? "Recovered changes" : !resolved.title ? "Add a title" : error ? "Not saved" : undefined;
  const serverRevisions = detail.inspectorData.revisions;
  const revisions = [...serverRevisions.filter(item => !localRevisions.some(local => local.id === item.id)), ...localRevisions]
    .filter(item => item.history?.state !== "WORKING" || item.id === savedRevision);
  async function keepVersion(name: string) {
    flushEditor();
    const currentWriter = queue.current;
    if (!currentWriter || !editable || recovery || composing.current) throw new Error("Finish editing or recovering the document before keeping a version.");
    const expectedCurrentRevisionId = await currentWriter.saveCurrent();
    const revision = await governanceRequest<SavedRevision>(`/api/documents/${detail.inspectorData.documentId}/checkpoint`, "POST", { expectedCurrentRevisionId, name }, { notifyMutation: false });
    const history = revision.history;
    setLocalRevisions(previous => [...previous.filter(item => item.id !== revision.revisionId), {
      id: revision.revisionId, revisionNo: revision.revisionNo, createdAt: revisions.find(item => item.id === revision.revisionId)?.createdAt ?? savedAt,
      history: history ? { ...history, windowStartedAt: history.windowStartedAt ? new Date(history.windowStartedAt) : null } : undefined,
    }]);
    metadataDirty.current = true;
    refreshMetadata();
  }
  const displayTitle = dirty || recovery ? resolved.title || "Untitled" : savedTitle;
  const Article = "article";
  // With the page's actions in the pinned line rather than on a row of its own above the title.
  const markdownToggle = <Button type="button" variant="ghost" aria-pressed={source || failed} disabled={!loaded || failed} onClick={() => {
    flushEditor();
    if (!source) sourceRef.current = true;
    setSource(value => !value);
  }}>Markdown</Button>;
  const article = <>
    {recovery && <p role="status" className="mb-3 text-body-sm">
      {recovery === "stale" ? "This document changed while you were away. Your recovered text is kept here; download it before loading the latest version." : "Your unsaved changes were recovered."}
      {recovery === "current" && <Button variant="link" onClick={() => setRecovery(null)}>Resume saving</Button>}
      <Button variant="link" onClick={() => setDiscarding(true)}>Discard recovered changes</Button>
    </p>}
    {error && <div className="mb-3"><GovernanceError error={error} />
      {conflict ? <p className="text-body-sm">Someone updated this document. Your text is still here. Download your changes before loading the latest version.</p> : null}
      {!conflict && <Button variant="link" disabled={!editable} onClick={() => void writer?.retry()}>Retry save</Button>}
      <Button variant="link" onClick={() => setDiscarding(true)}>Load latest version</Button>
    </div>}
    {(error || recovery) && <Button variant="link" onClick={() => {
      flushEditor();
      const value = queue.current!.current;
      const url = URL.createObjectURL(new Blob([value.markdown], { type: "text/markdown;charset=utf-8" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${(resolve(value).title || "recovered-document").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 120)}.md`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }}>Download my changes</Button>}
    {failed && <p role="status" className="mb-3 text-body-sm">Rendered editing is unavailable. You can continue in Markdown.</p>}
    <div onPointerDownCapture={() => { if (!ready) standInPressed.current = true; }} onCompositionStart={() => { composing.current = true; writer?.pause(true); }} onCompositionEnd={() => {
      composing.current = false;
      flushEditor();
      writer?.pause(!editable || !!recovery || !resolve(queue.current!.current).title);
    }} onBlur={() => flushEditor()} onKeyDownCapture={event => {
      if ((event.metaKey || event.ctrlKey) && event.key === "/" && !event.nativeEvent.isComposing && !failed) {
        event.preventDefault(); flushEditor();
        if (!source) sourceRef.current = true;
        setSource(value => !value);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && (event.key === "s" || event.key === "Enter") && !event.nativeEvent.isComposing) {
        event.preventDefault(); flushEditor(); void writer?.flush();
      }
    }}>
      {!ready && !source && !failed && !recovery ? standIn : null}
      <Article data-review-document={ready && !source && !failed ? "" : undefined} hidden={source || failed || !ready}>
        {loaded && Editor && !failed && <Editor reviewMarkdown={ready && !source && !recovery ? content.markdown : undefined} renderCode={renderCode} links={links} workspaceId={detail.inspectorData.workspaceId} documentId={detail.inspectorData.documentId}
          markdown={content.markdown} editable={editable && !source} onReady={(instance, openedWith) => {
            editor.current = instance;
            if (openedWith !== queue.current!.current.markdown) instance.replaceMarkdown(queue.current!.current.markdown);
            if (standInPressed.current) revealAfterPress.current = true;
            else setReady(true);
          }} onFail={() => setFailed(true)} onUserEdit={() => {
            pending.current = true;
            // ProseMirror calls this during transaction application; serialize after it has committed.
            queueMicrotask(() => { if (alive.current) flushRef.current(); });
          }} onMarkdown={() => { if (pending.current) flushEditor(); }} />}
      </Article>
      {(source || failed) && <textarea ref={sourceTextarea} aria-label="Markdown" value={content.markdown} disabled={!editable}
        onChange={event => {
          const next = event.target.value;
          const before = resolve(content);
          const after = resolve({ ...content, markdown: next });
          change({ title: carryTitle(before, after, content.title), markdown: next });
        }} className="min-h-[60vh] w-full resize-y border-0 bg-transparent text-reading text-kh-text outline-none" />}
    </div>
  </>;
  return <DocumentDetailClient {...detail} title={displayTitle} updatedAt={savedAt} onInspect={refreshMetadata} onKeepVersion={editable && !recovery ? keepVersion : undefined}
    inspectorData={{ ...detail.inspectorData, revisions, selectedRevisionNo: revisions.find(item => item.id === savedRevision)?.revisionNo ?? detail.inspectorData.selectedRevisionNo }}
    breadcrumb={[...detail.breadcrumb.slice(0, -1), { label: displayTitle }]} outline={outline}
    contentOwnsTitle={markdownOpensWithHeading(content.markdown)}
    editorActions={<><AutosaveIndicator state={status} attention={attention} />{markdownToggle}</>}
    titleControl={resolved.source === "TYPED" ? <input aria-label="Title" value={content.title} disabled={!editable} maxLength={512}
      onChange={event => change({ ...queue.current!.current, title: event.target.value })}
      className="mt-2 block w-full border-0 bg-transparent p-0 text-heading font-semibold tracking-tight text-kh-text outline-none"
      onCompositionStart={() => { composing.current = true; writer?.pause(true); }}
      onCompositionEnd={() => { composing.current = false; writer?.pause(!editable || !!recovery || !resolve(queue.current!.current).title); }} /> : undefined}>
    <div className="kh-reading-column py-6">
      {personal && <ReadRevisionMarker workspaceId={detail.inspectorData.workspaceId} documentId={detail.inspectorData.documentId} revisionId={savedRevision} />}
      {personal ? <OwnerReviewPanel documentId={detail.inspectorData.documentId} revisionId={savedRevision} markdown={content.markdown} prepareComment={prepareComment} commentAvailable={editable && ready && !recovery && !source && !failed} contentPending={dirty || !!recovery || source || failed || !ready}>{article}</OwnerReviewPanel> : article}
      {backlinks}
    </div>
    <ConfirmDialog open={discarding} onOpenChange={setDiscarding} title="Discard your unsaved changes?"
      description="Download your changes first if you want to keep them. Loading the latest version will discard the text in this editor."
      confirmLabel="Discard and load latest" cancelLabel="Keep editing" onConfirm={() => {
        discardingRef.current = true;
        queue.current?.dispose();
        clearDraft(browserDraftStorage(), keyRef.current);
        void persistent.current?.clear().then(() => window.location.reload());
        if (!persistent.current) window.location.reload();
      }} />
  </DocumentDetailClient>;
}
