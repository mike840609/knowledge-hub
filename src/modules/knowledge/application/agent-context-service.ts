import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { KnowledgeUnitOfWork } from "../ports/unit-of-work";
import { DocumentNotFoundError, IntegrityViolationError } from "../domain/errors";
import { DomainError } from "@/shared/domain/errors";
import { formatAgentContext, validateContextSelection, type AgentContextDocument } from "../domain/agent-context";
import { requireVisibleDocument } from "./internal/require-visible-document";
import { assertActiveDocumentPlacement } from "./tree-validation";
import { byCreation, projectAgentDiscussion } from "../domain/agent-context-discussion";
import { createReviewAnchorRelocator } from "../domain/review-anchor";
import { isRetractedThread } from "../domain/document-review";
export class AgentContextService {
  constructor(private readonly uow: KnowledgeUnitOfWork) {}
  async build(caller: CallerContext, workspaceId: string, rawIds: unknown, origin = "") {
    const ids = validateContextSelection(rawIds);
    return this.uow.run(async r => {
      await r.workspaceAccess.requireWorkspaceRead(caller, workspaceId);
      const workspace = await r.workspaces.findById(workspaceId);
      if (!workspace || workspace.workspaceType !== "PERSONAL" || workspace.personalOwnerUserId !== caller.identity.id || workspace.lifecycleState !== "ACTIVE") throw new DomainError("WORKSPACE_NOT_FOUND", "Workspace unavailable.");
      const documents: AgentContextDocument[] = [];
      const authors = new Map<string, string>();
      for (const id of ids) {
        const { document, policy } = await requireVisibleDocument(r, caller, id, false);
        if (policy.workspaceId !== workspaceId) throw new DocumentNotFoundError();
        const tree = await r.tree.listBySource(document.sourceId);
        if (!tree.some(node => node.documentId === document.id && node.status === "ACTIVE")) throw new DocumentNotFoundError();
        await assertActiveDocumentPlacement(r, document.sourceId, document.id, tree);
        const revision = await r.revisions.findCurrent(document.id);
        if (!revision) throw new IntegrityViolationError("Saved revision unavailable.");
        const entry = await r.linkedEntries.findByDocumentId(document.id);
        const contextDocument: AgentContextDocument = { documentId: document.id, sourceId: document.sourceId, sourceName: policy.name, sourcePath: entry?.sourcePath ?? null, revisionId: revision.id, revisionNo: revision.revisionNo, title: revision.title, markdown: revision.markdown, updatedAt: revision.createdAt, discussions: [] };
        documents.push(contextDocument);
        // Bound memory throughout assembly, not only after reading all selected bodies.
        formatAgentContext(workspaceId, documents, origin);
        const relocate = createReviewAnchorRelocator(revision.markdown);
        const threads = (await r.reviewThreads.listByDocument(document.id)).sort(byCreation);
        for (const thread of threads) {
          if (thread.visibility === "HIDDEN") continue;
          const comments = await r.reviewComments.listByThread(thread.id);
          if (isRetractedThread(comments)) continue;
          for (const comment of comments) {
            if (!authors.has(comment.authorUserId)) authors.set(comment.authorUserId, (await r.users.findById(comment.authorUserId))?.name ?? "Unknown author");
          }
          const discussion = projectAgentDiscussion(thread, comments, relocate(thread.anchor, thread.createdRevisionId === revision.id), authors);
          if (discussion) contextDocument.discussions!.push(discussion);
          formatAgentContext(workspaceId, documents, origin);
        }
      }
      return formatAgentContext(workspaceId, documents, origin);
    });
  }
}
