"use client";

import Link from "next/link";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { DocumentTopbarContext } from "@/components/shell/document-topbar-context";
import { InspectorContext } from "./inspector-context";
import { X } from "lucide-react";
import type { KnowledgeRevisionView } from "@/modules/knowledge/application/knowledge-query-service";
import { Drawer } from "@/components/ui/drawer";
import { TabsList, TabsPanel, TabsRoot, TabsTab } from "@/components/ui/tabs";
import { DocumentHeader, type DocumentBreadcrumbSegment } from "./document-header";

function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function revisionHref(input: {
  workspaceId: string;
  sourceId: string;
  documentId: string;
  revisionNo: number;
  includeArchived: boolean;
}): string {
  const params = new URLSearchParams();
  if (input.includeArchived) params.set("includeArchived", "true");
  params.set("revision", String(input.revisionNo));
  return `/w/${input.workspaceId}/knowledge/${input.sourceId}/${input.documentId}?${params.toString()}`;
}

export type DocumentInspectorData = {
  workspaceId: string;
  workspaceName: string;
  sourceId: string;
  sourceName: string;
  documentId: string;
  status: "ACTIVE" | "ARCHIVED";
  revisions: KnowledgeRevisionView[];
  selectedRevisionNo: number;
  includeArchived: boolean;
};

function InspectorTabs({ data }: { data: DocumentInspectorData }) {
  const { access } = useWorkspaceAuthorization();
  const sorted = [...data.revisions].sort((a, b) => a.revisionNo - b.revisionNo);
  const current = sorted[sorted.length - 1];
  const created = sorted[0]?.createdAt;

  return (
    <TabsRoot defaultValue="details">
      <TabsList aria-label="Document inspector">
        <TabsTab value="details">Details</TabsTab>
        <TabsTab value="history">History</TabsTab>
      </TabsList>
      <TabsPanel value="details">
        <dl className="space-y-2.5 text-[13px]">
          <div>
            <dt className="text-xs text-kh-text-muted">Workspace</dt>
            <dd className="mt-0.5 text-kh-text">{data.workspaceName}</dd>
          </div>
          <div>
            <dt className="text-xs text-kh-text-muted">Source</dt>
            <dd className="mt-0.5 text-kh-text">{data.sourceName}</dd>
            {access.actions.canInspectSources ? <dd className="mt-1"><Link href={`/w/${data.workspaceId}/sources/${data.sourceId}`} className="rounded text-kh-link underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-kh-focus">Manage source</Link></dd> : null}
          </div>
          <div>
            <dt className="text-xs text-kh-text-muted">Status</dt>
            <dd className="mt-0.5 text-kh-text">{data.status}</dd>
          </div>
          <div>
            <dt className="text-xs text-kh-text-muted">Current revision</dt>
            <dd className="mt-0.5 text-kh-text">
              {current ? `Revision ${current.revisionNo}` : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-kh-text-muted">Created</dt>
            <dd className="mt-0.5 text-kh-text">
              {created ? formatDateTime(created) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-kh-text-muted">Updated</dt>
            <dd className="mt-0.5 text-kh-text">
              {current ? formatDateTime(current.createdAt) : "—"}
            </dd>
          </div>
        </dl>
        <div className="mt-4 space-y-1 border-t border-kh-border pt-3 font-mono text-[11px] leading-relaxed text-kh-text-muted">
          <p className="break-all">Document {data.documentId}</p>
          <p className="break-all">Source {data.sourceId}</p>
          <p className="break-all">Workspace {data.workspaceId}</p>
          {current ? <p className="break-all">Revision {current.id}</p> : null}
        </div>
      </TabsPanel>
      <TabsPanel value="history">
        <ul className="space-y-1">
          {sorted.map((revision) => {
            const isCurrent = current && revision.id === current.id;
            const isSelected = revision.revisionNo === data.selectedRevisionNo;
            return (
              <li key={revision.id}>
                <Link
                  href={revisionHref({
                    workspaceId: data.workspaceId,
                    sourceId: data.sourceId,
                    documentId: data.documentId,
                    revisionNo: revision.revisionNo,
                    includeArchived: data.includeArchived,
                  })}
                  aria-current={isSelected ? "page" : undefined}
                  className={`flex items-center justify-between gap-2 rounded-md px-2.5 py-2 text-[13px] hover:bg-kh-bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-focus ${isSelected ? "bg-kh-bg-selected font-medium text-kh-text" : "text-kh-text"}`}
                >
                  <span>
                    Revision {revision.revisionNo}
                    {isCurrent ? " (current)" : ""}
                  </span>
                  <span className="shrink-0 text-xs text-kh-text-muted">
                    {formatDateTime(revision.createdAt)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </TabsPanel>
    </TabsRoot>
  );
}

function useWideInspector(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1440px)");
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return wide;
}

export function DocumentInspector({
  open,
  onOpenChange,
  data,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: DocumentInspectorData;
}) {
  const wide = useWideInspector();
  if (!open) return null;
  if (wide) {
    return (
      <aside
        aria-label="Document details"
        className="hidden h-full min-h-0 w-80 shrink-0 flex-col border-l border-kh-border bg-kh-bg min-[1440px]:flex"
      >
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-kh-border px-4 py-3">
          <h2 className="truncate text-sm font-semibold text-kh-text">Document details</h2>
          <button
            type="button"
            aria-label="Close details"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-kh-text-muted hover:bg-kh-bg-hover hover:text-kh-text focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-focus"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div key={data.documentId} role="region" aria-label="Document details content" tabIndex={0}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain break-words px-4 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-kh-focus">
          <InspectorTabs data={data} />
        </div>
      </aside>
    );
  }
  return (
    <Drawer
      key={data.documentId}
      open={open}
      onOpenChange={onOpenChange}
      modal={false}
      title="Document details"
      description={data.sourceName}
    >
      <InspectorTabs data={data} />
    </Drawer>
  );
}

export function DocumentDetailClient({
  breadcrumb,
  title,
  status,
  updatedAt,
  revisionBanner,
  inspectorData,
  children,
  editHref,
  readOnly,
}: {
  breadcrumb: DocumentBreadcrumbSegment[];
  title: string;
  status: "ACTIVE" | "ARCHIVED";
  updatedAt: Date;
  revisionBanner: { viewingNo: number; backHref: string } | null;
  inspectorData: DocumentInspectorData;
  children: ReactNode;
  editHref: string | null;
  readOnly: boolean;
}) {
  const inspector = useContext(InspectorContext);
  const setDocumentTopbar = useContext(DocumentTopbarContext)?.setDocument;
  const pathname = usePathname();
  const headerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!window.location.hash) contentRef.current?.scrollTo({ top: 0 });
  }, [inspectorData.documentId]);
  const inspectorOpen = inspector?.open ?? false;
  const setInspectorOpen = inspector?.setOpen;
  const openInspector = useCallback(() => {
    setInspectorOpen?.(true);
    window.dispatchEvent(new CustomEvent("kh:open-inspector"));
  }, [setInspectorOpen]);
  useEffect(() => {
    const header = headerRef.current;
    const root = contentRef.current;
    if (!header || !root || !setDocumentTopbar) return;
    setDocumentTopbar({ pathname, title, visible: false, onDetailsClick: openInspector });
    const observer = new IntersectionObserver(([entry]) => {
      const visible = !entry.isIntersecting && entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? 0);
      setDocumentTopbar({ pathname, title, visible, onDetailsClick: openInspector });
    }, { root, threshold: 0 });
    observer.observe(header);
    return () => {
      observer.disconnect();
      setDocumentTopbar(null);
    };
  }, [pathname, title, openInspector, setDocumentTopbar]);
  return (
    <div data-document-pane className="flex h-full min-h-0 overflow-hidden">
      <div ref={contentRef} role="region" aria-label="Document content" tabIndex={0}
        className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain contain-layout focus-visible:outline focus-visible:outline-2 focus-visible:outline-kh-focus">
        <div ref={headerRef}>
        <DocumentHeader
          breadcrumb={breadcrumb}
          title={title}
          status={status}
          updatedAt={updatedAt}
          revisionBanner={revisionBanner}
          onDetailsClick={openInspector}
          editHref={editHref}
          readOnly={readOnly}
        />
        </div>
        {children}
      </div>
      <DocumentInspector open={inspectorOpen} onOpenChange={(open) => setInspectorOpen?.(open)} data={inspectorData} />
    </div>
  );
}
