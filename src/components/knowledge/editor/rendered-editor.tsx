"use client";

import { useEffect, useRef, type MouseEvent } from "react";
import { isAllowedMarkdownImageSrc } from "@/components/knowledge/markdown-image-policy";
import { MARKDOWN_PROSE } from "@/components/knowledge/markdown-prose";
import { governanceRequest } from "@/components/workspaces/governance-error";
import type { LinkTargetsView } from "@/modules/knowledge/application/knowledge-link-service";
import { createMarkdownEditor, type MarkdownEditor } from "./editor-core";
import { selectionToolbar } from "./selection-toolbar";
import { wikiLinkSuggest } from "./wikilink-suggest";

export type RenderedEditorProps = {
  /** The Workspace whose documents `[[` offers. */
  workspaceId: string;
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
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MarkdownEditor | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Its own host, so the two editors a Strict Mode double-mount briefly
    // builds never share a node, and the loser leaves nothing behind.
    const host = document.createElement("div");
    container.appendChild(host);
    let cancelled = false;
    const toolbar = selectionToolbar();
    const suggest = wikiLinkSuggest({
      // Read through the ref at the moment of use, like every other prop here.
      loadTargets: () => governanceRequest<LinkTargetsView>(`/api/workspaces/${latest.current.workspaceId}/link-targets`),
      excludeDocumentId: () => latest.current.documentId,
    });
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
      extraPlugins: [...toolbar.plugins, ...suggest.plugins],
      configure: (ctx) => {
        toolbar.configure(ctx);
        suggest.configure(ctx);
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

  // A plain click on a link edits the text around it and never navigates, editable or not
  // (a non-editable anchor would follow itself); ⌘/Ctrl-click follows it, as the reader's links do.
  function followLinkOnModifierClick(event: MouseEvent<HTMLDivElement>) {
    const link = (event.target as HTMLElement).closest("a");
    if (!link) return;
    event.preventDefault();
    const href = link.getAttribute("href");
    if (href && (event.metaKey || event.ctrlKey)) window.open(href, "_blank", "noopener,noreferrer");
  }

  return <div ref={containerRef} onClick={followLinkOnModifierClick} />;
}
