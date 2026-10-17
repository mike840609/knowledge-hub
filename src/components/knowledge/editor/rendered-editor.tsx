"use client";

import { useContext, useLayoutEffect, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { InlineReviewContext } from "../inline-review-context";
import { readReviewRange } from "../review-selection";
import { isAllowedMarkdownImageSrc } from "@/components/knowledge/markdown-image-policy";
import { MARKDOWN_PROSE } from "@/components/knowledge/markdown-prose";
import { governanceRequest } from "@/components/workspaces/governance-error";
import { blockGutter } from "./block-gutter";
import { tableActions } from "./table-actions";
import { slashCommands } from "./slash-commands";
import type { LinkTargetsView } from "@/modules/knowledge/application/knowledge-link-service";
import { createMarkdownEditor, type MarkdownEditor } from "./editor-core";
import { selectionToolbar } from "./selection-toolbar";
import { wikiLinkSuggest } from "./wikilink-suggest";

import { editorViewCtx } from "@milkdown/kit/core";
import { editorReviewPathsPlugin, preserveEditorSelection, updateEditorReviewPaths } from "./review-paths";
import { createPortal } from "react-dom";
import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import { MarkdownAnchor } from "../markdown-base";
import type { RenderedLinks } from "../rendered-links";
import { parseWikiLinkParts } from "@/modules/knowledge/domain/document-links";
import { headingSlug } from "@/shared/markdown/heading-slug";
import { WIKILINK_TARGET, WIKILINK_FRAGMENT, WIKILINK_ANCHOR } from "../remark-knowledge-links";

export type RenderedEditorProps = {
  /** The Workspace whose documents `[[` offers. */
  workspaceId: string;
  links?: RenderedLinks;
  reviewMarkdown?: string;
  renderCode?: (code: string, language: string) => ReactNode;
  /** The document being edited, when there is one: `[[` does not offer it to itself. */
  documentId?: string;
  /** What to open with. Later changes go in through the handle `onReady` gave. */
  markdown: string;
  editable: boolean;
  /**
   * The editor is built. `openedWith` is exactly the Markdown it was built from: `markdown` may
   * have moved on while it was building, and the caller then has to bring the editor up to date.
   */
  onReady: (editor: MarkdownEditor, openedWith: string) => void;
  /** The editor could not be built (or made nothing of a non-empty document). */
  onFail: () => void;
  onUserEdit: () => void;
  onMarkdown: (markdown: string) => void;
};

/**
 * The rendered editing surface (composer spec §11). It is loaded with
 * `next/dynamic` and `ssr: false`, so Milkdown and ProseMirror stay out of the
 * first bundle and never run on the server.
 *
 * It builds the editor once. Props other than `editable` are read through a ref
 * at the moment they are needed, so a re-render never rebuilds the editor.
 */
export function RenderedEditor(props: RenderedEditorProps) {
  const review = useContext(InlineReviewContext);
  const reviewRef = useRef(review);
  reviewRef.current = review;
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MarkdownEditor | null>(null);
  const [wikiViews, setWikiViews] = useState<{ dom: HTMLElement; raw: string }[]>([]);
  const [codeViews, setCodeViews] = useState<{ dom: HTMLElement; preview: HTMLElement; pre: HTMLElement; code: string; language: string; editing: boolean; setEditing: (value: boolean) => void }[]>([]);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    // The toolbar belongs to ProseMirror rather than React, so a React selection
    // validity update must explicitly refresh its visibility.
    const commentGroup = containerRef.current?.querySelector<HTMLElement>("[data-review-comment-control]");
    if (commentGroup) commentGroup.hidden = !review?.available;
  }, [review?.available]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Its own host, so the two editors a Strict Mode double-mount briefly
    // builds never share a node, and the loser leaves nothing behind.
    const host = document.createElement("div");
    container.appendChild(host);
    let cancelled = false;
    const toolbar = selectionToolbar({
      available: () => !!reviewRef.current?.available,
      run: view => {
        const native = view.dom.ownerDocument.getSelection();
        // A pointer preserves the native range; keyboard activation uses the
        // editor's stored selection after Tab has moved focus into the toolbar.
        const range = native && !native.isCollapsed && native.rangeCount && view.dom.contains(native.anchorNode)
          ? native.getRangeAt(0).cloneRange() : (() => {
            const from = view.domAtPos(view.state.selection.from);
            const to = view.domAtPos(view.state.selection.to);
            const selected = document.createRange();
            selected.setStart(from.node, from.offset); selected.setEnd(to.node, to.offset);
            return selected;
          })();
        reviewRef.current?.request(markdown => {
          updateEditorReviewPaths(view, markdown);
          return readReviewRange(view.dom, markdown, range).anchor ?? null;
        });
      },
    });
    const suggest = wikiLinkSuggest({
      // Read through the ref at the moment of use, like every other prop here.
      loadTargets: () => governanceRequest<LinkTargetsView>(`/api/workspaces/${latest.current.workspaceId}/link-targets`),
      excludeDocumentId: () => latest.current.documentId,
    });
    const slash = slashCommands();
    const links = $prose(() => new Plugin({ props: { nodeViews: {
      wiki_link(node) {
        const dom = document.createElement("span");
        dom.setAttribute("data-kh-wiki-raw", String(node.attrs.raw));
        dom.contentEditable = "false";
        const entry = { dom, raw: String(node.attrs.raw) };
        queueMicrotask(() => { if (!cancelled) setWikiViews(previous => [...previous, entry]); });
        return { dom, ignoreMutation: () => true,
          stopEvent: event => !!(event.target as HTMLElement).closest("a"),
          destroy() { queueMicrotask(() => { if (!cancelled) setWikiViews(previous => previous.filter(item => item !== entry)); }); },
        };
      },
    } } }));
    const codeControllers = new Map<HTMLElement, () => void>();
    const codes = $prose(() => new Plugin({
      props: {
        handleDOMEvents: { focus() { requestAnimationFrame(() => codeControllers.forEach(sync => sync())); return false; } },
        nodeViews: {
          code_block(node, view, getPos) {
            const dom = document.createElement("div");
            const preview = document.createElement("div");
            preview.contentEditable = "false";
            const pre = document.createElement("pre");
            pre.hidden = true;
            const contentDOM = document.createElement("code");
            pre.appendChild(contentDOM);
            dom.append(preview, pre);
            const setEditing = (editing: boolean) => {
              pre.hidden = !editing;
              current = { ...current, editing };
              publish();
              if (editing) {
                const pos = getPos();
                if (pos !== undefined) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1)));
                view.focus();
              }
            };
            let current = { dom, preview, pre, code: node.textContent, language: String(node.attrs.language ?? ""), editing: false, setEditing };
            const publish = () => queueMicrotask(() => { if (!cancelled) setCodeViews(previous => previous.some(item => item.dom === dom) ? previous.map(item => item.dom === dom ? current : item) : [...previous, current]); });
            const sync = () => {
              const pos = getPos();
              if (pos === undefined || !view.hasFocus() || current.editing) return;
              const actual = view.state.doc.nodeAt(pos);
              const { from, to } = view.state.selection;
              if (actual && from > pos && to < pos + actual.nodeSize) {
                pre.hidden = false;
                current = { ...current, editing: true };
                publish();
              }
            };
            codeControllers.set(dom, sync);
            publish();
            return { dom, contentDOM,
              update(next) {
                if (next.type !== node.type) return false;
                if (next.textContent !== current.code || String(next.attrs.language ?? "") !== current.language) {
                  current = { ...current, code: next.textContent, language: String(next.attrs.language ?? "") };
                  publish();
                }
                return true;
              },
              stopEvent: event => preview.contains(event.target as Node),
              ignoreMutation: mutation => mutation.type !== "selection" && !contentDOM.contains(mutation.target),
              destroy() {
                codeControllers.delete(dom);
                queueMicrotask(() => { if (!cancelled) setCodeViews(previous => previous.filter(item => item.dom !== dom)); });
              },
            };
          },
        },
      },
      view: () => ({ update: () => codeControllers.forEach(sync => sync()) }),
    }));
    const openedWith = latest.current.markdown;
    createMarkdownEditor({
      root: host,
      markdown: openedWith,
      className: `kh-editor ${MARKDOWN_PROSE}`,
      ariaLabel: "Content",
      editable: latest.current.editable,
      onUserEdit: () => latest.current.onUserEdit(),
      onMarkdown: (markdown) => latest.current.onMarkdown(markdown),
      allowImage: (src) => isAllowedMarkdownImageSrc(src, { origin: window.location.origin }),
      extraPlugins: [editorReviewPathsPlugin, ...toolbar.plugins, ...suggest.plugins, ...slash.plugins, ...(latest.current.links ? [links] : []), ...(latest.current.renderCode ? [codes] : []), blockGutter(), tableActions()],
      configure: (ctx) => {
        toolbar.configure(ctx);
        suggest.configure(ctx);
        slash.configure(ctx);
      },
    }).then(
      (editor) => {
        if (cancelled) {
          void editor.destroy().catch(() => undefined);
          return;
        }
        editorRef.current = editor;
        // `editable` may have changed while the editor was building, when the effect below had no handle yet.
        editor.setEditable(latest.current.editable);
        latest.current.onReady(editor, openedWith);
      },
      () => {
        if (!cancelled) latest.current.onFail();
      },
    );
    return () => {
      cancelled = true;
      const editor = editorRef.current;
      editorRef.current = null;
      if (editor) void editor.destroy().catch(() => undefined);
      host.remove();
    };
  }, []);

  useEffect(() => {
    editorRef.current?.setEditable(props.editable);
  }, [props.editable]);

  useLayoutEffect(() => {
    editorRef.current?.action(ctx => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(preserveEditorSelection(view, view.state.tr));
    });
  }, [review]);

  useLayoutEffect(() => {
    const root = containerRef.current;
    const editor = editorRef.current;
    if (!root || !editor) return;
    const proven = editor.action(ctx => updateEditorReviewPaths(ctx.get(editorViewCtx), props.reviewMarkdown));
    if (proven) {
      const frame = requestAnimationFrame(() => root.dispatchEvent(new CustomEvent("kh:review-dom-ready", { bubbles: true })));
      return () => cancelAnimationFrame(frame);
    }
  }, [props.reviewMarkdown, props.renderCode, wikiViews, codeViews]);

  // A plain click on a link edits the text around it and never navigates, editable or not
  // (a non-editable anchor would follow itself); ⌘/Ctrl-click follows it, as the reader's links do.
  function followLinkOnModifierClick(event: MouseEvent<HTMLDivElement>) {
    const link = (event.target as HTMLElement).closest("a");
    if (!link || link.closest("[data-kh-wiki-raw]")) return;
    event.preventDefault();
    const href = link.getAttribute("href");
    if (href && (event.metaKey || event.ctrlKey)) window.open(href, "_blank", "noopener,noreferrer");
  }

  return <><div ref={containerRef} onClick={followLinkOnModifierClick} />{wikiViews.map(({ dom, raw }, index) => {
    const parts = parseWikiLinkParts(raw.slice(2, -2));
    const attributes = parts.target ? { [WIKILINK_TARGET]: parts.target, ...(parts.fragment ? { [WIKILINK_FRAGMENT]: parts.fragment } : {}) } : { [WIKILINK_ANCHOR]: headingSlug(parts.fragment ?? "") };
    return createPortal(<MarkdownAnchor links={props.links} {...attributes}>{parts.alias ?? (parts.target || parts.fragment)}</MarkdownAnchor>, dom, String(index));
  })}{codeViews.map(entry => createPortal(<>
    <div data-inline-code-preview hidden={entry.editing}>{props.renderCode?.(entry.code, entry.language)}</div>
    <button type="button" className="text-caption text-kh-text-muted hover:text-kh-text" onClick={() => entry.setEditing(!entry.editing)}>{entry.editing ? "Done editing code" : "Edit code"}</button>
  </>, entry.preview, String(codeViews.indexOf(entry))))}</>;

}
