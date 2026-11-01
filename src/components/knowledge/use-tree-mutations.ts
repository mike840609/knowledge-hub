"use client";

import { useCallback, useMemo } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { refreshOnArrival, refreshOnArrivalElsewhere } from "@/components/shell/refresh-on-arrival";
import { RetryableUndoError, useToast } from "@/components/ui/toast";
import { commitSourceTree } from "./source-tree-cache";
import type { KnowledgeTreeItem } from "@/modules/knowledge/application/knowledge-query-service";
import { governanceFailure, governanceRequest } from "@/components/workspaces/governance-error";
import {
  UNDO_LABEL,
  archivedDocument,
  archivedFolder,
  createdFolder,
  movedNode,
  organizeFailure,
  renamedFolder,
  restoredDocument,
  restoredFolder,
} from "./organize-messages";

// A source's PATCH must outlive the Sidebar/Tree that started it: filtering,
 // route navigation or a responsive drawer may unmount either client component.
 // The lease is per browser module instance and is released by the pending
 // request's finally block even when its initiating component is gone.
const sourceArrangements = new Set<string>();
// If a committed PATCH cannot be re-read, do not accept a second write based
// on stale tree positions. A full page reload clears this browser-local guard.
const staleArrangements = new Set<string>();

export type OrganizeResult = { ok: true } | { ok: false; message: string };

export type MoveNodeInput = {
  sourceId: string;
  nodeId: string;
  label: string;
  from: { parentId: string | null; position: number };
  to: { parentId: string | null; label: string | null; position?: number };
};

export type TreeMutations = {
  archiveDocument(input: { documentId: string; sourceId: string; title: string }): Promise<void>;
  restoreDocument(input: { documentId: string; sourceId: string; title: string }): Promise<void>;
  /** Creates a copy beside the original and opens it; Undo archives the copy. */
  duplicateDocument(input: { documentId: string; sourceId: string; title: string }): Promise<void>;
  archiveFolder(input: { nodeId: string; name: string }): Promise<void>;
  restoreFolder(input: { nodeId: string; name: string }): Promise<void>;
  /** For a dialog: the refusal comes back as words to put next to the field, not as a toast. */
  createFolder(input: { name: string; parentId: string | null; sourceId: string | null }): Promise<OrganizeResult>;
  renameFolder(input: { nodeId: string; from: string; to: string }): Promise<OrganizeResult>;
  /**
   * Into a folder, or to the top level with a null parent, last — or at `to.position` among that
   * parent's siblings. `from` is where it was, for the Undo; `to.label` is the folder's name, or null
   * for the top level. For a dialog, like the two above, a refusal comes back as words to put beside
   * the field; `report: "toast"` is for the drag surface, which has no field to put them beside.
   */
  moveNode(input: MoveNodeInput, report?: "dialog" | "toast", onRefreshRequested?: (authoritativeTree?: KnowledgeTreeItem[]) => void): Promise<OrganizeResult>;
  /**
   * To another place among its own siblings, from the keyboard. There is no dialog to put a refusal
   * beside, so it is said as a toast here, and there is no Undo toast either: a step is undone by the
   * step back, and a toast for every key press would bury the tree.
   */
  reorderNode(input: { nodeId: string; position: number; sourceId: string }, onRefreshRequested?: (authoritativeTree?: KnowledgeTreeItem[]) => void): Promise<OrganizeResult>;
  /** Survives the KnowledgeTree being filtered out and remounted. */
  isSourceArrangementPending(sourceId: string): boolean;
};

/**
 * The web's way of arranging what is written (daily-driver spec §7.3): each call is one request, then
 * a refresh of what the page shows, then a toast — and, where a reverse operation exists, an Undo
 * that runs it. Archiving and restoring both qualify (the lifecycle is ACTIVE and ARCHIVED, and the
 * document keeps its revisions and its place between them), and so does renaming; creating a folder
 * does not, since the nearest thing to taking it back is archiving it, which is not the same.
 *
 * It decides nothing about what the reader may do: the registry decides what is offered, and the
 * server decides what happens. A refusal is said in words (`organizeFailure`) and changes nothing here.
 */
export function useTreeMutations(): TreeMutations {
  const router = useRouter();
  const toast = useToast();
  const pathname = usePathname();
  const params = useParams<{ workspaceId?: string }>();
  const workspaceId = params?.workspaceId ?? "";

  const refresh = useCallback(() => router.refresh(), [router]);

  const failed = useCallback(
    (failure: unknown) => toast({ message: organizeFailure(governanceFailure(failure)), tone: "danger" }),
    [toast],
  );

  return useMemo<TreeMutations>(() => {
    const documentHref = (sourceId: string, documentId: string) => `/w/${workspaceId}/knowledge/${sourceId}/${documentId}`;
    const isOpen = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

    async function setDocument(action: "archive" | "restore", input: { documentId: string; sourceId: string; title: string }) {
      const href = documentHref(input.sourceId, input.documentId);
      // Archiving the document that is open leaves the reader on a page that no longer exists for them.
      const viewing = action === "archive" && isOpen(href);
      try {
        const result = await governanceRequest<{ backlinks: number | null } | null>(`/api/documents/${input.documentId}/${action}`, "POST");
        const undo = {
          label: UNDO_LABEL,
          run: async () => {
            await governanceRequest(`/api/documents/${input.documentId}/${action === "archive" ? "restore" : "archive"}`, "POST");
            // Back to where they were, if that is where the archive took them from.
            if (viewing) {
              refreshOnArrival(href);
              router.push(href);
            } else refresh();
          },
        };
        const message = action === "archive" ? archivedDocument(input.title, result?.backlinks ?? null) : restoredDocument(input.title);
        if (viewing) {
          const listHref = `/w/${workspaceId}/knowledge/${input.sourceId}`;
          // The toast is shown first and told to outlive the navigation it is about to cause.
          toast({ message, undo, survivesNavigation: true });
          // The source's page redirects, so where the reader lands is not known from here.
          refreshOnArrivalElsewhere();
          router.push(listHref);
        } else {
          toast({ message, undo });
          refresh();
        }
      } catch (failure) {
        failed(failure);
      }
    }

    async function setFolder(action: "archive" | "restore", input: { nodeId: string; name: string }) {
      try {
        await governanceRequest(`/api/tree-nodes/${input.nodeId}/${action}`, "POST");
        toast({
          message: action === "archive" ? archivedFolder(input.name) : restoredFolder(input.name),
          undo: {
            label: UNDO_LABEL,
            run: async () => {
              await governanceRequest(`/api/tree-nodes/${input.nodeId}/${action === "archive" ? "restore" : "archive"}`, "POST");
              refresh();
            },
          },
        });
        refresh();
      } catch (failure) {
        failed(failure);
      }
    }

    async function syncCommittedSource(sourceId: string, onRefreshRequested?: (tree?: KnowledgeTreeItem[]) => void): Promise<void> {
      try {
        // This response is about *this source*, after the PATCH committed. A
        // router refresh or another source's lazy load is not an acknowledgement.
        const response = await fetch(`/api/workspaces/${workspaceId}/sources/${sourceId}/tree`, { cache: "no-store" });
        if (!response.ok) throw new Error("The changed tree could not be loaded.");
        const body: unknown = await response.json();
        if (!body || typeof body !== "object" || !("tree" in body) || !Array.isArray(body.tree)) {
          throw new Error("Invalid source tree response.");
        }
        const tree = body.tree as KnowledgeTreeItem[];
        onRefreshRequested?.(tree);
        // Publish before releasing the source-scoped PATCH lease. Every mounted
        // explorer receives the new tree; a remounted explorer also starts with it.
        commitSourceTree(workspaceId, sourceId, tree);
      } catch {
        staleArrangements.add(`${workspaceId}:${sourceId}`);
        toast({ message: "The change was saved, but its tree could not be refreshed. Reload the page before sorting again.", tone: "danger" });
      }
      refresh();
    }

    // The sidebar owns this hook, whereas filtering may unmount and remount a
    // KnowledgeTree while its earlier PATCH is still pending. Keep the write
    // lease here, shared by pointer moves and keyboard reorders of one source.
    async function serializeArrangement(sourceId: string, write: () => Promise<OrganizeResult>): Promise<OrganizeResult> {
      const key = `${workspaceId}:${sourceId}`;
      if (sourceArrangements.has(key) || staleArrangements.has(key)) return { ok: false, message: "A tree change is still in progress." };
      sourceArrangements.add(key);
      try { return await write(); }
      finally { sourceArrangements.delete(key); }
    }

    return {
      isSourceArrangementPending: (sourceId) => sourceArrangements.has(`${workspaceId}:${sourceId}`) || staleArrangements.has(`${workspaceId}:${sourceId}`),
      async moveNode({ sourceId, nodeId, label, from, to }, report = "dialog", onRefreshRequested) {
        return serializeArrangement(sourceId, async () => {
        try {
          await governanceRequest(`/api/tree-nodes/${nodeId}`, "PATCH", {
            parentId: to.parentId,
            ...(to.position !== undefined ? { position: to.position } : {}),
          });
          toast({
            message: movedNode(label, to.label),
            undo: {
              label: UNDO_LABEL,
              run: async () => {
                // Undo must obey the same source-level lease as a drag, keyboard
                // reorder or dialog move. Never issue a competing raw PATCH.
                const result = await serializeArrangement(sourceId, async () => {
                  await governanceRequest(`/api/tree-nodes/${nodeId}`, "PATCH", { parentId: from.parentId, position: from.position });
                  await syncCommittedSource(sourceId);
                  return { ok: true };
                });
                if (!result.ok) throw new RetryableUndoError(result.message);
              },
            },
          });
          await syncCommittedSource(sourceId, onRefreshRequested);
          return { ok: true };
        } catch (failure) {
          const message = organizeFailure(governanceFailure(failure));
          // The dialog shows the words beside its field; a drag has no field, so it is never silent.
          if (report === "toast") toast({ message, tone: "danger" });
          return { ok: false, message };
        }
        });
      },
      async reorderNode({ sourceId, nodeId, position }, onRefreshRequested) {
        return serializeArrangement(sourceId, async () => {
        try {
          await governanceRequest(`/api/tree-nodes/${nodeId}`, "PATCH", { position });
          await syncCommittedSource(sourceId, onRefreshRequested);
          return { ok: true };
        } catch (failure) {
          const message = organizeFailure(governanceFailure(failure));
          toast({ message, tone: "danger" });
          return { ok: false, message };
        }
        });
      },
      archiveDocument: (input) => setDocument("archive", input),
      restoreDocument: (input) => setDocument("restore", input),
      async duplicateDocument({ documentId, sourceId, title }) {
        try {
          const created = await governanceRequest<{ documentId: string }>(`/api/documents/${documentId}/duplicate`, "POST");
          const href = `/w/${workspaceId}/knowledge/${sourceId}/${created.documentId}`;
          const originalHref = documentHref(sourceId, documentId);
          // A copy is opened, as a reader expects from Duplicate; the Undo
          // follows it rather than the page it came from, and takes the reader
          // back to the original when the copy was the page on screen.
          toast({
            message: `Duplicated “${title}”.`,
            undo: {
              label: UNDO_LABEL,
              run: async () => {
                await governanceRequest(`/api/documents/${created.documentId}/archive`, "POST");
                if (isOpen(href)) {
                  refreshOnArrival(originalHref);
                  router.push(originalHref);
                } else refresh();
              },
            },
            survivesNavigation: true,
          });
          refreshOnArrival(href);
          router.push(href);
        } catch (failure) {
          failed(failure);
        }
      },
      archiveFolder: (input) => setFolder("archive", input),
      restoreFolder: (input) => setFolder("restore", input),
      async createFolder({ name, parentId, sourceId }) {
        try {
          await governanceRequest(`/api/workspaces/${workspaceId}/folders`, "POST", { name, parentId, ...(sourceId ? { sourceId } : {}) });
          toast({ message: createdFolder(name.trim()) });
          refresh();
          return { ok: true };
        } catch (failure) {
          return { ok: false, message: organizeFailure(governanceFailure(failure)) };
        }
      },
      async renameFolder({ nodeId, from, to }) {
        try {
          await governanceRequest(`/api/tree-nodes/${nodeId}`, "PATCH", { name: to });
          toast({
            message: renamedFolder(to.trim()),
            undo: {
              label: UNDO_LABEL,
              run: async () => {
                await governanceRequest(`/api/tree-nodes/${nodeId}`, "PATCH", { name: from });
                refresh();
              },
            },
          });
          refresh();
          return { ok: true };
        } catch (failure) {
          return { ok: false, message: organizeFailure(governanceFailure(failure)) };
        }
      },
    };
  }, [workspaceId, pathname, router, toast, refresh, failed]);
}
