"use client";

import { useCallback, useMemo } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { refreshOnArrival, refreshOnArrivalElsewhere } from "@/components/shell/refresh-on-arrival";
import { useToast } from "@/components/ui/toast";
import { governanceFailure, governanceRequest } from "@/components/workspaces/governance-error";
import {
  UNDO_LABEL,
  archivedDocument,
  archivedFolder,
  createdFolder,
  organizeFailure,
  renamedFolder,
  restoredDocument,
  restoredFolder,
} from "./organize-messages";

export type OrganizeResult = { ok: true } | { ok: false; message: string };

export type TreeMutations = {
  archiveDocument(input: { documentId: string; sourceId: string; title: string }): Promise<void>;
  restoreDocument(input: { documentId: string; sourceId: string; title: string }): Promise<void>;
  archiveFolder(input: { nodeId: string; name: string }): Promise<void>;
  restoreFolder(input: { nodeId: string; name: string }): Promise<void>;
  /** For a dialog: the refusal comes back as words to put next to the field, not as a toast. */
  createFolder(input: { name: string; parentId: string | null; sourceId: string | null }): Promise<OrganizeResult>;
  renameFolder(input: { nodeId: string; from: string; to: string }): Promise<OrganizeResult>;
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

    return {
      archiveDocument: (input) => setDocument("archive", input),
      restoreDocument: (input) => setDocument("restore", input),
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
