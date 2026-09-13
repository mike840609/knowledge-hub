"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
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
                  className={`flex items-center justify-between gap-2 rounded-md px-2.5 py-2 text-[13px] hover:bg-kh-bg-hover ${isSelected ? "bg-kh-bg-selected font-medium text-kh-text" : "text-kh-text"}`}
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
        className="hidden w-80 shrink-0 border-l border-kh-border bg-kh-bg min-[1440px]:block"
      >
        <div className="flex items-start justify-between gap-2 border-b border-kh-border px-4 py-3">
          <h2 className="truncate text-sm font-semibold text-kh-text">Document details</h2>
          <button
            type="button"
            aria-label="Close details"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-kh-text-muted hover:bg-kh-bg-hover hover:text-kh-text focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-accent"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="px-4 py-3">
          <InspectorTabs data={data} />
        </div>
      </aside>
    );
  }
  return (
    <Drawer
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
}: {
  breadcrumb: DocumentBreadcrumbSegment[];
  title: string;
  status: "ACTIVE" | "ARCHIVED";
  updatedAt: Date;
  revisionBanner: { viewingNo: number; backHref: string } | null;
  inspectorData: DocumentInspectorData;
  children: ReactNode;
}) {
  const [inspectorOpen, setInspectorOpen] = useState(false);
  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1">
        <DocumentHeader
          breadcrumb={breadcrumb}
          title={title}
          status={status}
          updatedAt={updatedAt}
          revisionBanner={revisionBanner}
          onDetailsClick={() => setInspectorOpen(true)}
        />
        {children}
      </div>
      <DocumentInspector open={inspectorOpen} onOpenChange={setInspectorOpen} data={inspectorData} />
    </div>
  );
}
