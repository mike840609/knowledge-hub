import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { TaskReferenceInput } from "../../domain/task-references";
import type { ReferenceResolution, StoredTaskReference } from "../../ports/task-export-store";
import type { TaskKnowledgeRepositories } from "../../ports/unit-of-work";

/**
 * Exact, bound-Source-only Wiki resolution (design §7). A caller-less helper:
 * only the ingest service imports it. No title ranking, no other Source, no
 * guess — a path either names exactly one ACTIVE document or it does not.
 */
export async function resolveTaskReferences(
  r: TaskKnowledgeRepositories,
  boundSourceId: string,
  references: readonly TaskReferenceInput[],
): Promise<StoredTaskReference[]> {
  const resolved: StoredTaskReference[] = [];
  for (const [ordinal, reference] of references.entries()) {
    if (reference.type !== "WIKI") {
      resolved.push({ ordinal, reference, resolution: null, resolvedDocumentId: null });
      continue;
    }
    const documentIds = "path" in reference
      ? await activeDocumentsAtPath(r, boundSourceId, reference.path)
      : await activeDocumentById(r, boundSourceId, reference.documentId);
    const resolution: ReferenceResolution = documentIds.length === 1 ? "RESOLVED" : documentIds.length > 1 ? "AMBIGUOUS" : "UNRESOLVED";
    resolved.push({ ordinal, reference, resolution, resolvedDocumentId: resolution === "RESOLVED" ? documentIds[0] : null });
  }
  return resolved;
}

async function activeDocumentsAtPath(r: TaskKnowledgeRepositories, sourceId: string, path: string): Promise<string[]> {
  const match = await r.entries.findActiveEntriesByPath(sourceId, path);
  if (match.kind === "INVALID_PATH") return [];
  const active: string[] = [];
  for (const { documentId } of match.candidates) {
    if ((await r.documents.getState(documentId))?.status === "ACTIVE") active.push(documentId);
  }
  return active;
}

async function activeDocumentById(r: TaskKnowledgeRepositories, sourceId: string, documentId: string): Promise<string[]> {
  const state = await r.documents.getState(documentId);
  return state?.status === "ACTIVE" && state.sourceId === sourceId ? [documentId] : [];
}

/**
 * Re-judged on every read: a stored document id is evidence, not a
 * capability. Only the My Space owner, and only while the document and its
 * Source are ACTIVE, gets RESOLVED; the answer names nothing either way.
 */
export async function readTaskReferenceAvailability(
  r: TaskKnowledgeRepositories,
  caller: CallerContext,
  input: { boundSourceId: string; reference: StoredTaskReference },
): Promise<"RESOLVED" | "UNAVAILABLE"> {
  const documentId = input.reference.resolution === "RESOLVED" ? input.reference.resolvedDocumentId : null;
  if (!documentId) return "UNAVAILABLE";
  const source = await r.sources.getById(input.boundSourceId);
  if (!source || source.status !== "ACTIVE") return "UNAVAILABLE";
  const workspace = await r.workspaces.lockSharedById(source.workspaceId);
  if (!workspace || workspace.kind !== "PERSONAL" || workspace.ownerUserId !== caller.identity.id) return "UNAVAILABLE";
  const document = await r.documents.getState(documentId);
  return document?.status === "ACTIVE" && document.sourceId === input.boundSourceId ? "RESOLVED" : "UNAVAILABLE";
}
