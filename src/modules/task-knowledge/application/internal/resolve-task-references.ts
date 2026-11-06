import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { TaskReferenceInput } from "../../domain/task-references";
import type { ReferenceResolution, StoredTaskReference } from "../../ports/task-export-store";
import type { TaskKnowledgeRepositories } from "../../ports/unit-of-work";

/**
 * Exact Wiki resolution inside the binding's Workspace (design §7). A
 * caller-less helper: only application services import it. No title ranking,
 * no other Workspace, no guess — a path names exactly one ACTIVE document
 * across the Workspace's synced folders, or several (AMBIGUOUS), or none.
 */
export async function resolveTaskReferences(
  r: TaskKnowledgeRepositories,
  workspaceId: string,
  references: readonly TaskReferenceInput[],
): Promise<StoredTaskReference[]> {
  const resolved: StoredTaskReference[] = [];
  for (const [ordinal, reference] of references.entries()) {
    if (reference.type !== "WIKI") {
      resolved.push({ ordinal, reference, resolution: null, resolvedDocumentId: null });
      continue;
    }
    const documentIds = "path" in reference
      ? await activeDocumentsAtPath(r, workspaceId, reference.path)
      : await activeDocumentById(r, workspaceId, reference.documentId);
    const resolution: ReferenceResolution = documentIds.length === 1 ? "RESOLVED" : documentIds.length > 1 ? "AMBIGUOUS" : "UNRESOLVED";
    resolved.push({ ordinal, reference, resolution, resolvedDocumentId: resolution === "RESOLVED" ? documentIds[0] : null });
  }
  return resolved;
}

async function activeDocumentsAtPath(r: TaskKnowledgeRepositories, workspaceId: string, path: string): Promise<string[]> {
  const match = await r.entries.findActiveEntriesByPath(workspaceId, path);
  if (match.kind === "INVALID_PATH") return [];
  const active: string[] = [];
  for (const { documentId } of match.candidates) {
    if ((await r.documents.getState(documentId))?.status === "ACTIVE") active.push(documentId);
  }
  return active;
}

/** An ACTIVE document whose ACTIVE Source lies in the Workspace. */
async function liveDocumentInWorkspace(r: TaskKnowledgeRepositories, workspaceId: string, documentId: string): Promise<boolean> {
  const state = await r.documents.getState(documentId);
  if (state?.status !== "ACTIVE") return false;
  const source = await r.sources.getById(state.sourceId);
  return source?.status === "ACTIVE" && source.workspaceId === workspaceId;
}

async function activeDocumentById(r: TaskKnowledgeRepositories, workspaceId: string, documentId: string): Promise<string[]> {
  return (await liveDocumentInWorkspace(r, workspaceId, documentId)) ? [documentId] : [];
}

/**
 * Re-judged on every read: a stored document id is evidence, not a
 * capability. Only the My Space owner, and only while the document and its
 * Source are ACTIVE, gets RESOLVED; the answer names nothing either way.
 */
export async function readTaskReferenceAvailability(
  r: TaskKnowledgeRepositories,
  caller: CallerContext,
  input: { workspaceId: string; reference: StoredTaskReference },
): Promise<"RESOLVED" | "UNAVAILABLE"> {
  const documentId = input.reference.resolution === "RESOLVED" ? input.reference.resolvedDocumentId : null;
  if (!documentId) return "UNAVAILABLE";
  const workspace = await r.workspaces.lockSharedById(input.workspaceId);
  if (!workspace || workspace.kind !== "PERSONAL" || workspace.ownerUserId !== caller.identity.id) return "UNAVAILABLE";
  return (await liveDocumentInWorkspace(r, input.workspaceId, documentId)) ? "RESOLVED" : "UNAVAILABLE";
}
