import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { SourceUnitOfWork } from "@/modules/sources/ports/unit-of-work";
import type { KnowledgeQueryService } from "@/modules/knowledge/application/knowledge-query-service";
import {
  evaluateWorkspaceCapabilities,
  requireWorkspaceRead,
} from "@/modules/workspaces/application/workspace-authorization";
import { DomainError } from "@/shared/domain/errors";
import { isUuid } from "@/shared/ids/uuidv7";
export class DocumentReadProgressService {
  constructor(
    private readonly uow: SourceUnitOfWork,
    private readonly queries: KnowledgeQueryService,
  ) {}
  async markRead(
    caller: CallerContext,
    input: { workspaceId: string; documentId: string; revisionId: string },
  ): Promise<void> {
    if (
      !isUuid(input.workspaceId) ||
      !isUuid(input.documentId) ||
      !isUuid(input.revisionId)
    )
      throw new DomainError(
        "INVALID_REQUEST",
        "Provide a valid document and revision.",
      );
    await this.uow.run(async (r) => {
      const workspace = await r.workspaces.findById(input.workspaceId);
      if (
        workspace?.workspaceType !== "PERSONAL" ||
        workspace.personalOwnerUserId !== caller.identity.id ||
        workspace.lifecycleState !== "ACTIVE"
      )
        throw new DomainError(
          "WORKSPACE_NOT_FOUND",
          "Personal workspace unavailable.",
        );
      requireWorkspaceRead(
        await evaluateWorkspaceCapabilities(r, caller, input.workspaceId),
      );
    });
    const document = await this.queries.getDocument(caller, input.documentId, {
      includeArchived: true,
    });
    if (document.workspaceId !== input.workspaceId)
      throw new DomainError("DOCUMENT_NOT_FOUND", "Document unavailable.");
    await this.uow.run(async (r) => {
      requireWorkspaceRead(
        await evaluateWorkspaceCapabilities(r, caller, input.workspaceId),
      );
      const revision = await r.revisions.findById(input.revisionId);
      if (!revision || revision.documentId !== input.documentId)
        throw new DomainError("REVISION_NOT_FOUND", "Revision unavailable.");
      await r.documentReadProgress.advance({
        userId: caller.identity.id,
        ...input,
        revisionNo: revision.revisionNo,
        readAt: new Date(),
      });
    });
  }
}
