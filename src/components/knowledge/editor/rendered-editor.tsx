"use client";

import { useEffect, useRef, type MouseEvent } from "react";
import { isAllowedMarkdownImageSrc } from "@/components/knowledge/markdown-image-policy";
import { MARKDOWN_PROSE } from "@/components/knowledge/markdown-prose";
import { createMarkdownEditor, type MarkdownEditor } from "./editor-core";
import { selectionToolbar } from "./selection-toolbar";

export type RenderedEditorProps = {
  /** What to open with. Later changes go in through the handle `onReady` gave. */
  markdown: string;
  editable: boolean;
  onReady: (editor: MarkdownEditor) => void;
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
    createMarkdownEditor({
      root: host,
      markdown: latest.current.markdown,
      className: `kh-editor ${MARKDOWN_PROSE}`,
      ariaLabel: "Content",
      editable: latest.current.editable,
      onUserEdit: () => latest.current.onUserEdit(),
      onMarkdown: (markdown) => latest.current.onMarkdown(markdown),
      allowImage: (src) => isAllowedMarkdownImageSrc(src, { origin: window.location.origin }),
      extraPlugins: toolbar.plugins,
      configure: toolbar.configure,
    }).then(
      (editor) => {
        if (cancelled) {
          void editor.destroy();
          return;
        }
        editorRef.current = editor;
        latest.current.onReady(editor);
      },
      () => {
        if (!cancelled) latest.current.onFail();
      },
    );
    return () => {
      cancelled = true;
      const editor = editorRef.current;
      editorRef.current = null;
      if (editor) void editor.destroy();
      host.remove();
    };
  }, []);

  useEffect(() => {
    editorRef.current?.setEditable(props.editable);
  }, [props.editable]);

  // A plain click on a link edits the text around it; ⌘/Ctrl-click follows it, as the reader's links do.
  function followLinkOnModifierClick(event: MouseEvent<HTMLDivElement>) {
    if (!(event.metaKey || event.ctrlKey)) return;
    const link = (event.target as HTMLElement).closest("a");
    const href = link?.getAttribute("href");
    if (!href) return;
    event.preventDefault();
    window.open(href, "_blank", "noopener,noreferrer");
  }

  return <div ref={containerRef} onClick={followLinkOnModifierClick} />;
}
