"use client";

import Link from "next/link";
import { requestShare } from "@/components/actions/action-menu";
import { availableActions } from "@/components/actions/action-registry";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { DocumentTopbarContext } from "@/components/shell/document-topbar-context";
import { InspectorContext } from "./inspector-context";
import { useScrollRestoration } from "./use-scroll-restoration";
import { Check, Copy, X } from "lucide-react";
import type { KnowledgeRevisionView } from "@/modules/knowledge/application/knowledge-query-service";
import { Drawer } from "@/components/ui/drawer";
import { TabsList, TabsPanel, TabsRoot, TabsTab } from "@/components/ui/tabs";
import { DocumentHeader, type DocumentBreadcrumbSegment } from "./document-header";
import { buttonClasses } from "@/components/ui/button";
import { Timestamp } from "@/components/ui/timestamp";

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

function TechnicalIds({ items }: { items: { label: string; value: string }[] }) {
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setMessage(`${label} ID copied`);
    } catch {
      setCopied(null);
      setMessage("Could not copy. Select the ID and copy it manually.");
    }
  }
  return (
    <details className="mt-4 border-t border-kh-border pt-3 text-caption text-kh-text-muted">
      <summary className="cursor-pointer rounded-md py-1 kh-focus-ring">Technical IDs</summary>
      <div className="mt-2 space-y-3">
        {items.map(({ label, value }) => (
          <div key={label}>
            <div className="flex items-center justify-between gap-2">
              <span>{label}</span>
              <button type="button" aria-label={`Copy ${label.toLowerCase()} ID`} onClick={() => void copy(label, value)} className={buttonClasses({ variant: "ghost", icon: true, size: "sm" })}>
                {copied === label ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
              </button>
            </div>
            <code className="block select-all break-all text-micro leading-relaxed">{value}</code>
          </div>
        ))}
        <p role="status" className="text-caption">{message}</p>
      </div>
    </details>
  );
}

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
        <dl className="space-y-3 text-body-sm [&>div]:grid [&>div]:grid-cols-[6rem_minmax(0,1fr)] [&>div]:items-baseline [&>div]:gap-x-3 [&_dd]:col-start-2 [&_dd]:min-w-0 [&_dd]:break-words">
          <div>
            <dt className="text-caption text-kh-text-muted">Workspace</dt>
            <dd className="text-kh-text">{data.workspaceName}</dd>
          </div>
          <div>
            <dt className="text-caption text-kh-text-muted">Source</dt>
            <dd className="text-kh-text">{data.sourceName}</dd>
            {access.actions.canInspectSources ? <dd className="mt-1"><Link href={`/w/${data.workspaceId}/sources/${data.sourceId}`} className="rounded-md text-kh-link underline underline-offset-4 kh-focus-ring">Manage source</Link></dd> : null}
          </div>
          <div>
            <dt className="text-caption text-kh-text-muted">Status</dt>
            <dd className="text-kh-text">{data.status === "ACTIVE" ? "Active" : "Archived"}</dd>
          </div>
          <div>
            <dt className="text-caption text-kh-text-muted">Current revision</dt>
            <dd className="text-kh-text">
              {current ? `Revision ${current.revisionNo}` : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-kh-text-muted">Created</dt>
            <dd className="text-kh-text">
              {created ? <Timestamp value={created} /> : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-kh-text-muted">Updated</dt>
            <dd className="text-kh-text">
              {current ? <Timestamp value={current.createdAt} /> : "—"}
            </dd>
          </div>
        </dl>
        <TechnicalIds items={[
          { label: "Document", value: data.documentId },
          { label: "Source", value: data.sourceId },
          { label: "Workspace", value: data.workspaceId },
          ...(current ? [{ label: "Revision", value: current.id }] : []),
        ]} />
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
                  className={`flex items-center justify-between gap-2 rounded-md px-2.5 py-2 text-body-sm hover:bg-kh-bg-hover kh-focus-ring ${isSelected ? "bg-kh-bg-selected font-medium text-kh-text" : "text-kh-text"}`}
                >
                  <span>
                    Revision {revision.revisionNo}
                    {isCurrent ? " (current)" : ""}
                  </span>
                  <span className="shrink-0 text-caption text-kh-text-muted">
                    <Timestamp value={revision.createdAt} />
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
        className="hidden h-full min-h-0 w-80 shrink-0 flex-col border-l border-kh-border/70 bg-kh-bg-raised min-[1440px]:flex"
      >
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-kh-border/70 px-4 py-3">
          <h2 className="truncate text-body font-semibold text-kh-text">Document details</h2>
          <button
            type="button"
            aria-label="Close details"
            onClick={() => onOpenChange(false)}
            className={buttonClasses({ variant: "ghost", icon: true, size: "sm" })}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div key={data.documentId} role="region" aria-label="Document details content" tabIndex={0}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain break-words px-4 py-3 kh-focus-ring">
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
      surfaceClassName="bg-kh-bg-raised"
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
  sourceStatus,
  readOnly,
  ownership,
  contentOwnsTitle,
}: {
  breadcrumb: DocumentBreadcrumbSegment[];
  title: string;
  status: "ACTIVE" | "ARCHIVED";
  updatedAt: Date;
  revisionBanner: { viewingNo: number; backHref: string } | null;
  inspectorData: DocumentInspectorData;
  children: ReactNode;
  editHref: string | null;
  /**
   * The collection's own lifecycle. A document can be ACTIVE inside an
   * archived source; every action that would be refused there must not be
   * offered, so the target's state folds both together.
   */
  sourceStatus: "ACTIVE" | "ARCHIVED";
  readOnly: boolean;
  /** Passed rather than inferred from `readOnly`: the two happen to agree today. */
  ownership: "SOURCE_MANAGED" | "HUB_MANAGED";
  contentOwnsTitle: boolean;
}) {
  const inspector = useContext(InspectorContext);
  const setDocumentTopbar = useContext(DocumentTopbarContext)?.setDocument;
  const pathname = usePathname();
  const headerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useScrollRestoration(contentRef, inspectorData.documentId);
  const inspectorOpen = inspector?.open ?? false;
  const setInspectorOpen = inspector?.setOpen;
  const openInspector = useCallback(() => {
    setInspectorOpen?.(true);
    window.dispatchEvent(new CustomEvent("kh:open-inspector"));
  }, [setInspectorOpen]);
  useEffect(() => {
    if (!setInspectorOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat || event.altKey || event.shiftKey) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "i") return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
      event.preventDefault();
      if (inspectorOpen) setInspectorOpen(false);
      else openInspector();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [inspectorOpen, openInspector, setInspectorOpen]);
  // The palette asks for the inspector from outside the document pane, which
  // owns whether it is open; this is the pane answering.
  useEffect(() => {
    if (!setInspectorOpen) return;
    const onRequest = () => openInspector();
    window.addEventListener("kh:request-details", onRequest);
    return () => window.removeEventListener("kh:request-details", onRequest);
  }, [openInspector, setInspectorOpen]);
  const target = useMemo(
    () => ({
      documentId: inspectorData.documentId,
      sourceId: inspectorData.sourceId,
      label: title,
      ownership,
      status: status === "ACTIVE" && sourceStatus === "ACTIVE" ? ("ACTIVE" as const) : ("ARCHIVED" as const),
      revision: revisionBanner ? ("HISTORICAL" as const) : ("CURRENT" as const),
    }),
    [inspectorData.documentId, inspectorData.sourceId, title, ownership, status, sourceStatus, revisionBanner],
  );
  // The header asks the registry, like every other surface (action-model
  // spec §4; share-link spec §10.1), rather than re-deriving the rule.
  const { access, confirmed } = useWorkspaceAuthorization();
  const canShare = availableActions({
    workspaceId: inspectorData.workspaceId,
    workspaceType: access.workspace.type,
    can: access.actions,
    confirmed,
    target: { ...target, favorite: false },
  }).some((action) => action.id === "document.share");
  useEffect(() => {
    const header = headerRef.current;
    const root = contentRef.current;
    if (!header || !root || !setDocumentTopbar) return;
    setDocumentTopbar({ pathname, title, visible: false, onDetailsClick: openInspector, target });
    const observer = new IntersectionObserver(([entry]) => {
      const visible = !entry.isIntersecting && entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? 0);
      setDocumentTopbar({ pathname, title, visible, onDetailsClick: openInspector, target });
    }, { root, threshold: 0 });
    observer.observe(header);
    return () => {
      observer.disconnect();
      setDocumentTopbar(null);
    };
  }, [pathname, title, openInspector, setDocumentTopbar, target]);
  return (
    <div data-document-pane className="flex h-full min-h-0 overflow-hidden bg-kh-bg-raised">
      <div ref={contentRef} role="region" aria-label="Document content" tabIndex={0}
        className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain contain-layout kh-focus-ring">
        <div ref={headerRef}>
        <DocumentHeader
          breadcrumb={breadcrumb}
          title={title}
          status={status}
          updatedAt={updatedAt}
          revisionBanner={revisionBanner}
          onDetailsClick={openInspector}
          editHref={editHref}
          onShareClick={canShare ? () => requestShare(inspectorData.documentId) : null}
          readOnly={readOnly}
          contentOwnsTitle={contentOwnsTitle}
        />
        </div>
        {children}
      </div>
      <DocumentInspector open={inspectorOpen} onOpenChange={(open) => setInspectorOpen?.(open)} data={inspectorData} />
    </div>
  );
}
