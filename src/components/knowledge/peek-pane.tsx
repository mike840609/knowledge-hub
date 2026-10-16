"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { ChevronsLeft } from "lucide-react";
import type { DocumentLinkView } from "@/modules/knowledge/application/knowledge-link-service";
import type { KnowledgeQueryService } from "@/modules/knowledge/application/knowledge-query-service";
import {
  GovernanceError,
  governanceFailure,
  governanceRequest,
  type GovernanceFailure,
} from "@/components/workspaces/governance-error";
import { buttonClasses } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { ActionIcon } from "@/components/actions/action-icon";
import { requestShare } from "@/components/actions/action-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { extractOutline } from "@/shared/markdown/outline";
import { markdownOpensWithHeading } from "@/lib/markdown-title";
import { DocumentViewer } from "./document-viewer";
import { OutlineRail } from "./document-outline";
import { BacklinksFooter } from "./backlinks-footer";
import { DocumentPane } from "./document-pane";
import { DocumentHeader } from "./document-header";
import type { DocumentBreadcrumbSegment } from "./document-breadcrumb";
import { useActiveHeading } from "./use-active-heading";
import { renderedLinksFrom } from "./rendered-links";
import type { PeekRequest } from "./peek-request";

type DocumentDetails = Awaited<ReturnType<KnowledgeQueryService["getDocument"]>>;

type PeekResult = {
  title: string;
  markdown: string;
  ownership: "HUB_MANAGED" | "SOURCE_MANAGED";
  workspaceId: string;
  sourceId: string;
  documentId: string;
  breadcrumb: DocumentBreadcrumbSegment[];
  updatedAt: string;
  status: "ACTIVE" | "ARCHIVED";
  sourceStatus: "ACTIVE" | "ARCHIVED";
  readOnly: boolean;
  editHref: string | null;
  syncHref: string | null;
  canShare: boolean;
  linkView?: DocumentLinkView | null;
};

function readIncludeArchivedSuffix(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("includeArchived") === "true"
    ? "?includeArchived=true"
    : "";
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * A rendered document link (`/w/:workspaceId/knowledge/:sourceId/:documentId`,
 * optionally with a `#fragment`), or null for anything else — the full-page
 * and edit links, cross-workspace links, and external links navigate normally.
 */
function parsePaneDocumentHref(href: string): {
  workspaceId: string;
  sourceId: string;
  documentId: string;
  fragment: string | null;
} | null {
  const hashIndex = href.indexOf("#");
  const path = hashIndex < 0 ? href : href.slice(0, hashIndex);
  const rawFragment = hashIndex < 0 ? "" : href.slice(hashIndex + 1);
  const match = /^\/w\/([^/]+)\/knowledge\/([^/]+)\/([^/?#]+)$/.exec(path);
  if (!match) return null;
  return {
    workspaceId: safeDecode(match[1]),
    sourceId: safeDecode(match[2]),
    documentId: safeDecode(match[3]),
    fragment: rawFragment === "" ? null : safeDecode(rawFragment),
  };
}

function scrollToSlugInPane(root: HTMLElement | null, slug: string): void {
  if (!root || slug === "") return;
  const target = root.querySelector<HTMLElement>(`[id="${CSS.escape(slug)}"]`);
  if (target) target.scrollIntoView({ block: "start" });
}

/**
 * A fully browsable side-peek pane: the document's full reader, its outline,
 * and its backlinks, with same-workspace document links navigating inside the
 * pane. The main page is never touched — the layout agent owns where this
 * sits and when it opens; this owns only what it shows.
 */
export function PeekPane({ request, onClose }: { request: PeekRequest; onClose: () => void }) {
  const [documentId, setDocumentId] = useState(request.documentId);
  const [peek, setPeek] = useState<PeekResult | null>(null);
  const [error, setError] = useState<GovernanceFailure | null>(null);
  // A response for any other document — the pane moved on before it arrived —
  // is dropped rather than shown.
  const current = useRef<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const [scrolledPast, setScrolledPast] = useState(false);
  const pendingFragment = useRef<string | null>(null);

  const load = useCallback(async (id: string, fragment: string | null = null) => {
    current.current = id;
    pendingFragment.current = fragment;
    setPeek(null);
    setError(null);
    try {
      const result = await governanceRequest<PeekResult>(`/api/documents/${id}/peek`);
      if (current.current === id) setPeek(result);
    } catch (failure) {
      if (current.current === id) setError(governanceFailure(failure));
    }
  }, []);

  useEffect(() => {
    setDocumentId(request.documentId);
    void load(request.documentId);
  }, [request.documentId, request.sourceId, load]);

  // A dialog above the pane owns Escape while focus is inside it; this is not
  // a dialog, so it only answers when no dialog does.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target as Element | null;
      if (target && typeof target.closest === "function" && target.closest('[role="dialog"]')) return;
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // The pinned breadcrumb's fade matches the full page: it appears once the
  // header scrolls away under it, tracked against this pane's own scroller.
  useEffect(() => {
    const header = headerRef.current;
    const root = contentRef.current;
    if (!header || !root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setScrolledPast(
          !entry.isIntersecting && entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? 0),
        );
      },
      { root, threshold: 0 },
    );
    observer.observe(header);
    return () => observer.disconnect();
  }, [peek?.documentId]);

  // Each arrival starts at the top, unless the link that led here named a
  // heading — then the pane opens on it.
  useEffect(() => {
    if (!peek) return;
    if (pendingFragment.current) {
      const slug = pendingFragment.current;
      pendingFragment.current = null;
      scrollToSlugInPane(contentRef.current, slug);
    } else if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [peek]);

  const [archivedSuffix, setArchivedSuffix] = useState("");
  useEffect(() => {
    setArchivedSuffix(readIncludeArchivedSuffix());
  }, [request]);

  const canonicalHref = peek
    ? `/w/${peek.workspaceId}/knowledge/${peek.sourceId}/${peek.documentId}${archivedSuffix}`
    : null;
  const loading = peek === null && error === null;

  const entries = useMemo(() => (peek ? extractOutline(peek.markdown) : []), [peek]);
  const activeSlug = useActiveHeading(
    entries.map((entry) => entry.slug),
    contentRef,
  );

  const view: DocumentDetails | null = useMemo(
    () =>
      peek
        ? {
            documentId: peek.documentId,
            sourceId: peek.sourceId,
            workspaceId: peek.workspaceId,
            status: "ACTIVE",
            currentRevision: {
              id: "",
              documentId: peek.documentId,
              revisionNo: 1,
              title: peek.title,
              markdown: peek.markdown,
              metadata: {},
              contentHash: "",
              createdBy: "",
              createdAt: new Date(0),
            },
          }
        : null,
    [peek],
  );

  // Same-workspace document links stay in the pane; everything else — external
  // links (already new-tab), cross-workspace links, the header's full-page
  // links (outside this container) — navigates as it would.
  const onContentClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      if (href.startsWith("#")) {
        event.preventDefault();
        scrollToSlugInPane(contentRef.current, safeDecode(href.slice(1)));
        return;
      }
      if (!href.startsWith("/w/")) return;
      const parsed = parsePaneDocumentHref(href);
      if (!parsed || !peek || parsed.workspaceId !== peek.workspaceId) return;
      event.preventDefault();
      if (parsed.documentId === documentId) {
        if (parsed.fragment) scrollToSlugInPane(contentRef.current, parsed.fragment);
        return;
      }
      setDocumentId(parsed.documentId);
      void load(parsed.documentId, parsed.fragment);
    },
    [documentId, load, peek],
  );

  return (
    <section
      aria-label="Document preview"
      data-peek-pane
      className="flex h-full min-h-0 flex-col bg-kh-bg"
    >
      <div
        role="toolbar"
        aria-label="Preview actions"
        className="flex shrink-0 items-center justify-between px-4 py-2"
      >
        <div className="flex items-center gap-2">
          <Tooltip label="Close preview">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close preview"
              className={buttonClasses({ variant: "ghost", icon: true })}
            >
              <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
            </button>
          </Tooltip>
          {canonicalHref ? (
            <Tooltip label="Open as full page">
              <Link
                href={canonicalHref}
                aria-label="Open as full page"
                className={buttonClasses({ variant: "ghost", icon: true })}
              >
                <ActionIcon name="expand" className="h-4 w-4" />
              </Link>
            </Tooltip>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {peek?.editHref ? (
            <Tooltip label="Edit">
              <Link
                href={peek.editHref}
                aria-label="Edit"
                className={buttonClasses({ variant: "ghost", icon: true })}
              >
                <ActionIcon name="edit" className="h-4 w-4" />
              </Link>
            </Tooltip>
          ) : null}
          {peek?.canShare ? (
            <Tooltip label="Share link…">
              <button
                type="button"
                onClick={() => peek && requestShare(peek.documentId)}
                aria-label="Share link…"
                className={buttonClasses({ variant: "ghost", icon: true })}
              >
                <ActionIcon name="share" className="h-4 w-4" />
              </button>
            </Tooltip>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <DocumentPane
          contentRef={contentRef}
          outline={peek ? <OutlineRail entries={entries} activeSlug={activeSlug} /> : undefined}
          loading={loading}
        >
          {peek ? (
            <DocumentHeader
              breadcrumb={peek.breadcrumb}
              title={peek.title}
              status={peek.status}
              updatedAt={new Date(peek.updatedAt)}
              revisionBanner={null}
              // Edit and Share live in the peek toolbar above; the header keeps
              // only what describes the document so the two never double up.
              editHref={null}
              onShareClick={null}
              readOnly={peek.readOnly}
              syncHref={peek.syncHref}
              contentOwnsTitle={markdownOpensWithHeading(peek.markdown)}
              headerRef={headerRef}
              pinned={scrolledPast}
            />
          ) : null}
          {loading ? (
            <div className="kh-reading-column space-y-3 py-6">
              <p role="status" className="sr-only">
                Loading preview
              </p>
              <div aria-hidden="true" className="space-y-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
              </div>
            </div>
          ) : null}
          {error ? (
            <div className="kh-reading-column py-6">
              {error.code === "UNAUTHENTICATED" ? (
                <p className="text-body text-kh-text">Sign in to preview this document.</p>
              ) : null}
              <GovernanceError error={error} />
            </div>
          ) : null}
          {peek && view ? (
            // Capture phase: Next's Link checks defaultPrevented in its own
            // click handler, so a bubble-phase interception always loses the
            // race and the main page navigates. Intercepting here wins it.
            <div className="kh-reading-column py-6" onClickCapture={onContentClick}>
              <DocumentViewer
                view={view}
                links={peek.linkView ? renderedLinksFrom(peek.linkView) : undefined}
              />
              {peek.linkView ? <BacklinksFooter view={peek.linkView} /> : null}
            </div>
          ) : null}
        </DocumentPane>
      </div>
    </section>
  );
}
