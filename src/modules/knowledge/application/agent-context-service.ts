import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { KnowledgeUnitOfWork } from "../ports/unit-of-work";
import { DocumentNotFoundError, IntegrityViolationError } from "../domain/errors";
import { DomainError } from "@/shared/domain/errors";
import { formatAgentContext, validateContextSelection, type AgentContextDocument } from "../domain/agent-context";
import { requireVisibleDocument } from "./internal/require-visible-document";
import { assertActiveDocumentPlacement } from "./tree-validation";
export class AgentContextService {
  constructor(private readonly uow: KnowledgeUnitOfWork) {}
  async build(caller: CallerContext, workspaceId: string, rawIds: unknown, origin = "") {
    const ids = validateContextSelection(rawIds);
    return this.uow.run(async r => {
      await r.workspaceAccess.requireWorkspaceRead(caller, workspaceId);
      const workspace = await r.workspaces.findById(workspaceId);
      if (!workspace || workspace.workspaceType !== "PERSONAL" || workspace.personalOwnerUserId !== caller.identity.id || workspace.lifecycleState !== "ACTIVE") throw new DomainError("WORKSPACE_NOT_FOUND", "Workspace unavailable.");
      const documents: AgentContextDocument[] = [];
      for (const id of ids) {
        const { document, policy } = await requireVisibleDocument(r, caller, id, false);
        if (policy.workspaceId !== workspaceId) throw new DocumentNotFoundError();
        const tree = await r.tree.listBySource(document.sourceId);
        if (!tree.some(node => node.documentId === document.id && node.status === "ACTIVE")) throw new DocumentNotFoundError();
        await assertActiveDocumentPlacement(r, document.sourceId, document.id, tree);
        const revision = await r.revisions.findCurrent(document.id);
        if (!revision) throw new IntegrityViolationError("Saved revision unavailable.");
        const entry = await r.linkedEntries.findByDocumentId(document.id);
        documents.push({ documentId: document.id, sourceId: document.sourceId, sourceName: policy.name, sourcePath: entry?.sourcePath ?? null, revisionId: revision.id, revisionNo: revision.revisionNo, title: revision.title, markdown: revision.markdown, updatedAt: revision.createdAt });
        // Bound memory throughout assembly, not only after reading all selected bodies.
        formatAgentContext(workspaceId, documents, origin);
      }
      return formatAgentContext(workspaceId, documents, origin);
    });
  }
}
