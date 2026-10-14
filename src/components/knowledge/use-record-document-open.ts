"use client";

import { useEffect, useMemo, useRef } from "react";
import { useParams } from "next/navigation";
import { rememberDocument } from "@/lib/document-shortcuts";
import type { KnowledgeTreeItem, SourceView } from "@/modules/knowledge/application/knowledge-query-service";
import { documentShortcutKey, useDocumentShortcuts } from "./use-document-shortcuts";

/**
 * Opening a document puts it in Recent. This is the only place that records it, and the shell mounts it
 * (through `DocumentOpenRecorder`) at every width: the narrow window's sidebar lives in a drawer that is
 * unmounted while closed, so a recorder inside the sidebar would miss every document opened there.
 */
export function useRecordDocumentOpen(workspaceId: string, collections: { source: SourceView; tree: KnowledgeTreeItem[] }[]): void {
  const params = useParams();
  const sourceId = typeof params?.sourceId === "string" ? params.sourceId : undefined;
  const documentId = typeof params?.documentId === "string" ? params.documentId : undefined;
  const { update } = useDocumentShortcuts(workspaceId);
  const known = useMemo(() => {
    const keys = new Set<string>();
    for (const { source, tree } of collections) {
      for (const item of tree) if (item.type === "document") keys.add(documentShortcutKey(source.id, item.documentId));
    }
    return keys;
  }, [collections]);
  const recordedOpen = useRef<string | null>(null);
  useEffect(() => {
    const key = sourceId && documentId ? documentShortcutKey(sourceId, documentId) : null;
    const visit = key ? `${workspaceId}:${key}` : null;
    // Explorer refreshes rebuild `known` while the reader stays on the same document. Only entering it records an open.
    if (recordedOpen.current !== visit) recordedOpen.current = null;
    if (key && known.has(key) && recordedOpen.current !== visit) {
      recordedOpen.current = visit;
      update((previous) => rememberDocument(previous, key));
    }
  }, [workspaceId, sourceId, documentId, known, update]);
}

/** Renders nothing; it exists so the hook runs inside the shell's authorization provider. */
export function DocumentOpenRecorder({ workspaceId, collections }: { workspaceId: string; collections: { source: SourceView; tree: KnowledgeTreeItem[] }[] }): null {
  useRecordDocumentOpen(workspaceId, collections);
  return null;
}
