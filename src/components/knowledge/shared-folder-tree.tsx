"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from "react";
import { ChevronDown, ChevronRight, FileText, Folder, FolderTree } from "lucide-react";
import type { SharedTreeNode } from "@/modules/knowledge/application/document-share-service";
import { sharedFolderHref } from "@/lib/share-paths";
import { buttonClasses } from "@/components/ui/button";

type Children = ReadonlyMap<string | null, readonly SharedTreeNode[]>;

/** The folders above a document, nearest first; nothing for a document the tree does not hold. */
function foldersAbove(nodes: readonly SharedTreeNode[], documentId: string | null): string[] {
  const parentOf = new Map(nodes.map((node) => [node.id, node.parentId]));
  const path: string[] = [];
  let parent = nodes.find((node) => node.documentId !== null && node.documentId === documentId)?.parentId ?? null;
  while (parent !== null && path.length < nodes.length) {
    path.push(parent);
    parent = parentOf.get(parent) ?? null;
  }
  return path;
}

type Disclosure = { navId: string; buttonRef: RefObject<HTMLButtonElement | null>; open: boolean; setOpen: Dispatch<SetStateAction<boolean>> };
const DisclosureContext = createContext<Disclosure | null>(null);

function useDisclosure(): Disclosure {
  const disclosure = useContext(DisclosureContext);
  if (!disclosure) throw new Error("A shared folder's tree and its button belong inside SharedFolderTreeScope.");
  return disclosure;
}

/**
 * What the tree and its phone button share. It sits above the review panel, which is drawn afresh
 * for each document, so the button can live in that panel's bar while the tree itself (the folders a
 * reader opened, and where they scrolled it) is never drawn again as the reader moves.
 */
export function SharedFolderTreeScope({ children }: { children: ReactNode }) {
  const navId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ navId, buttonRef, open, setOpen }), [navId, open]);
  return <DisclosureContext.Provider value={value}>{children}</DisclosureContext.Provider>;
}

/** Below `sm`, the bar's button that shows the tree over the page. */
export function SharedFolderTreeButton() {
  const { navId, buttonRef, open, setOpen } = useDisclosure();
  return (
    <button ref={buttonRef} type="button" aria-expanded={open} aria-controls={navId} onClick={() => setOpen((current) => !current)} className={buttonClasses({ variant: "ghost", icon: true, className: "-ms-2 sm:hidden" })}>
      <FolderTree className="size-4" aria-hidden="true" />
      <span className="sr-only">Folder contents</span>
    </button>
  );
}

/**
 * A shared folder's tree (folder share spec §4): a rail pinned at the window's left under the bar,
 * or, below `sm`, a list over the page shown by `SharedFolderTreeButton`. One list either way,
 * so the folders a reader opened stay open whichever they see.
 *
 * Every document is a link to the folder page's `?d=`; nothing is prefetched, since a prefetch would
 * read the document through the link and count a view nobody took. The folders on the read
 * document's path start open, the others closed, and a document reached another way (a tree click,
 * an in-folder link) opens its path without closing what the reader opened.
 */
export function SharedFolderTree({ token, nodes, currentDocumentId, folderName }: { token: string; nodes: SharedTreeNode[]; currentDocumentId: string | null; folderName: string }) {
  const { navId, buttonRef, open, setOpen } = useDisclosure();
  const navRef = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState(() => new Set(foldersAbove(nodes, currentDocumentId)));
  const [shownFor, setShownFor] = useState(currentDocumentId);
  if (shownFor !== currentDocumentId) {
    setShownFor(currentDocumentId);
    setExpanded((current) => new Set([...current, ...foldersAbove(nodes, currentDocumentId)]));
  }
  const children = useMemo(() => {
    const byParent = new Map<string | null, SharedTreeNode[]>();
    for (const node of nodes) {
      const siblings = byParent.get(node.parentId);
      if (siblings) siblings.push(node);
      else byParent.set(node.parentId, [node]);
    }
    return byParent;
  }, [nodes]);
  // On a phone the list lies over the page: a press anywhere else puts it away, and so does
  // Escape, wherever focus is, handing focus back to the button.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!navRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open, setOpen, buttonRef]);
  const toggle = (id: string) => setExpanded((current) => {
    const next = new Set(current);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  return (
    <nav
      ref={navRef}
      id={navId}
      aria-label={folderName}
      className={`kh-shared-folder-tree fixed inset-x-0 top-14 z-30 max-h-[70vh] overflow-y-auto border-b border-kh-border bg-kh-bg p-3 shadow-popover sm:bottom-0 sm:right-auto sm:max-h-none sm:w-[var(--kh-tree-rail)] sm:border-b-0 sm:border-r sm:bg-kh-bg-explorer sm:shadow-none ${open ? "" : "max-sm:hidden"}`}
    >
      <p className="flex kh-rail-row min-w-0 items-center gap-2 px-2 kh-rail-text font-semibold text-kh-text">
        <Folder size={14} className="shrink-0 text-kh-text-muted" aria-hidden="true" />
        <span className="truncate">{folderName}</span>
      </p>
      <Branch parentId={null} tree={children} expanded={expanded} toggle={toggle} token={token} currentDocumentId={currentDocumentId} onNavigate={() => setOpen(false)} />
    </nav>
  );
}

function Branch({ parentId, tree, expanded, toggle, token, currentDocumentId, onNavigate }: {
  parentId: string | null;
  tree: Children;
  expanded: ReadonlySet<string>;
  toggle: (id: string) => void;
  token: string;
  currentDocumentId: string | null;
  onNavigate: () => void;
}) {
  const nodes = tree.get(parentId) ?? [];
  const nested = parentId === null ? "" : "ml-3 border-l border-kh-border pl-2";
  if (nodes.length === 0) return <p className={`flex kh-rail-row items-center px-2 kh-rail-text text-kh-text-muted ${nested}`}>Empty folder</p>;
  return (
    <ul className={nested}>
      {nodes.map((node) => {
        if (node.kind === "DOCUMENT" && node.documentId !== null) {
          const current = node.documentId === currentDocumentId;
          return (
            <li key={node.id}>
              <Link
                href={sharedFolderHref(token, node.documentId)}
                prefetch={false}
                aria-current={current ? "page" : undefined}
                onClick={onNavigate}
                title={node.name}
                className={`kh-interactive-row kh-control flex kh-rail-row min-w-0 items-center gap-2 px-2 kh-rail-text ${current ? "bg-kh-bg-selected font-medium text-kh-selected-text hover:bg-kh-bg-selected" : "text-kh-text-muted hover:text-kh-text"}`}
              >
                {node.pageIcon ? <span className="flex size-3.5 shrink-0 items-center justify-center text-body leading-none" aria-hidden="true">{node.pageIcon}</span> : <FileText size={14} className="shrink-0" aria-hidden="true" />}
                <span className="truncate">{node.name}</span>
              </Link>
            </li>
          );
        }
        const open = expanded.has(node.id);
        return (
          <li key={node.id}>
            <button type="button" aria-expanded={open} onClick={() => toggle(node.id)} title={node.name} className="kh-interactive-row kh-control flex kh-rail-row w-full min-w-0 items-center gap-2 px-2 text-left kh-rail-text font-medium text-kh-text">
              {open ? <ChevronDown size={14} className="shrink-0 text-kh-text-muted" aria-hidden="true" /> : <ChevronRight size={14} className="shrink-0 text-kh-text-muted" aria-hidden="true" />}
              <span className="truncate">{node.name}</span>
            </button>
            {open ? <Branch parentId={node.id} tree={tree} expanded={expanded} toggle={toggle} token={token} currentDocumentId={currentDocumentId} onNavigate={onNavigate} /> : null}
          </li>
        );
      })}
    </ul>
  );
}
