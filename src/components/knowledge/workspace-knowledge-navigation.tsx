"use client";

import { useLayoutEffect, useRef, useState, type MouseEventHandler } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import type { SourceView } from "@/modules/knowledge/application/knowledge-query-service";
import { FolderNameDialogHost } from "./folder-name-dialog";
import { MoveDialogHost } from "./move-dialog";
import { ShareLinkDialogHost } from "./share-link-dialog";
import { SourceSidebar } from "./source-sidebar";
import { useSourceTrees } from "./use-source-trees";

type WorkspaceKnowledgeNavigationProps = {
  workspaceId: string;
  sources: SourceView[] | null;
  target: HTMLElement | null;
  onClick?: MouseEventHandler<HTMLDivElement>;
};

const EMPTY_SOURCES: SourceView[] = [];

export function WorkspaceKnowledgeNavigation(props: WorkspaceKnowledgeNavigationProps) {
  return <WorkspaceKnowledge key={props.workspaceId} {...props} />;
}

function WorkspaceKnowledge({ workspaceId, sources, target, onClick }: WorkspaceKnowledgeNavigationProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  const headers = sources ?? EMPTY_SOURCES;
  const trees = useSourceTrees(workspaceId, headers);
  const lastSourceId = useRef<string | undefined>(undefined);

  const prefix = `/w/${workspaceId}/knowledge/`;
  const [sourceId, documentId, action, extra] = pathname.startsWith(prefix) ? pathname.slice(prefix.length).split("/") : [];
  const source = headers.find((candidate) => candidate.id === sourceId) ?? null;
  const selectedDocumentId = source && (!action || action === "edit") && extra === undefined ? documentId : undefined;
  const routeSourceId = source?.status === "ACTIVE" ? source.id : undefined;
  const defaultSourceId = (
    headers.find((candidate) => candidate.status === "ACTIVE" && candidate.id === lastSourceId.current)
    ?? headers.find((candidate) => candidate.status === "ACTIVE" && candidate.sourceType === "HUB" && candidate.name === "Notes")
    ?? headers.find((candidate) => candidate.status === "ACTIVE")
  )?.id;

  useLayoutEffect(() => {
    if (routeSourceId) lastSourceId.current = routeSourceId;
  }, [routeSourceId]);

  // Changing the container passed to createPortal remounts the explorer.
  // Move one container between slots to keep the scroll element and tree state.
  useLayoutEffect(() => {
    const element = document.createElement("div");
    element.className = "h-full min-h-0";
    setPortal(element);
    return () => element.remove();
  }, []);
  useLayoutEffect(() => {
    if (!portal) return;
    if (target) target.appendChild(portal);
    else portal.remove();
  }, [portal, target]);

  return (
    <>
      {portal && createPortal(
        <div className="contents" onClick={onClick}>
          {sources === null ? (
            <aside aria-label="Knowledge explorer" className="px-2">
              <h2 className="text-caption font-medium text-kh-text-muted">Knowledge</h2>
              <p role="status" className="mt-2 text-body text-kh-text-muted">
                Sources could not be loaded.{" "}
                <button type="button" className="underline kh-focus-ring" onClick={() => router.refresh()}>Retry</button>
              </p>
            </aside>
          ) : (
            <SourceSidebar
              workspaceId={workspaceId}
              source={source}
              defaultSourceId={defaultSourceId}
              selectedDocumentId={selectedDocumentId}
              sources={sources}
              collections={trees.collections}
              treeStates={trees.states}
              ensureTree={trees.ensure}
              retryTree={trees.retry}
            />
          )}
        </div>,
        portal,
      )}
      <FolderNameDialogHost workspaceId={workspaceId} />
      <MoveDialogHost workspaceId={workspaceId} collections={trees.collections} ensureTree={trees.ensure} retryTree={trees.retry} treeStates={trees.states} />
      <ShareLinkDialogHost />
    </>
  );
}
