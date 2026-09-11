import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { fingerprintRevisionContent, type RevisionContentInput } from "../../domain/content";
import { isRevisionContentUnchanged } from "../../domain/revision";
import {
  DocumentArchivedError,
  DocumentNotFoundError,
  IntegrityViolationError,
  RevisionConflictError,
  SourceArchivedError,
  SourceNotFoundError,
  SourceReadOnlyError,
} from "../../domain/errors";
import type { KnowledgeRepositories } from "../../ports/unit-of-work";

export type CreateRevisionInput = RevisionContentInput & {
  documentId: string;
  expectedCurrentRevisionId: string;
};

/**
 * Hub-managed revision creation bound to an already-open canonical transaction.
 *
 * Path (spec §11, plan §6): trusted CallerContext → authoritative
 * Document→Source→Workspace resolution on this connection → lock Source →
 * transaction-scoped WorkspaceAccessPolicy → Source HUB_MANAGED/ACTIVE and
 * Document ACTIVE validation → lock Document → expected-revision check →
 * canonicalization → NOOP → N+1 insert + pointer update.
 * Never opens a nested unit of work; the owning service commits once.
 */
export async function createRevisionInTransaction(
  repositories: KnowledgeRepositories,
  caller: CallerContext,
  input: CreateRevisionInput,
): Promise<{ revisionId: string; revisionNo: number; changed: boolean }> {
  await repositories.users.upsertIdentity(caller.identity);
  const existing = await repositories.documents.findById(input.documentId);
  if (!existing) throw new DocumentNotFoundError();
  const source = await repositories.sourcePolicy.lockById(existing.sourceId);
  if (!source) throw new SourceNotFoundError();
  await repositories.workspaceAccess.requireMembership(caller, source.workspaceId);
  if (source.status !== "ACTIVE") throw new SourceArchivedError();
  if (source.ownership !== "HUB_MANAGED") throw new SourceReadOnlyError();
  const document = await repositories.documents.lockById(input.documentId);
  if (!document) throw new DocumentNotFoundError();
  if (document.status !== "ACTIVE") throw new DocumentArchivedError();
  const current = await repositories.revisions.findCurrent(document.id);
  if (!current) throw new IntegrityViolationError("Document current revision is missing.");
  if (current.id !== input.expectedCurrentRevisionId) throw new RevisionConflictError();
  if (isRevisionContentUnchanged(current, input)) {
    return { revisionId: current.id, revisionNo: current.revisionNo, changed: false };
  }
  const { normalized: content, contentHash } = fingerprintRevisionContent(input);
  const revisionId = uuidv7();
  const revisionNo = await repositories.revisions.nextRevisionNumber(document.id);
  await repositories.revisions.insert({
    id: revisionId, documentId: document.id, revisionNo, ...content,
    contentHash, createdBy: caller.identity.id, createdAt: new Date(),
  });
  await repositories.documents.setCurrentRevision(document.id, revisionId, caller.identity.id);
  await repositories.documents.assertComplete(document.id);
  return { revisionId, revisionNo, changed: true };
}
