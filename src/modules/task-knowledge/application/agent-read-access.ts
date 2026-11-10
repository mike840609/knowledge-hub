import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { hashExportToken } from "../domain/export-credential";
import { AgentDocumentAmbiguousError, AgentDocumentNotFoundError, CredentialInvalidError, ScopeDeniedError } from "../domain/task-errors";
import type { TaskKnowledgeUnitOfWork } from "../ports/unit-of-work";
import { activeDocumentsAtPath } from "./internal/resolve-task-references";

export type AgentReadScope = { caller: CallerContext; workspaceId: string; bindingId: string; documentId: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Turns an export token into the owner's caller, pinned to the binding's My
 * Space (design §3). Like ingest it takes no CallerContext: the credential is
 * the authority. It makes ingest's checks without its locks, since it writes
 * nothing. Reached only from `src/app/api/agent/**` and `src/server/agent-read.ts`.
 */
export class AgentReadAccessService {
  constructor(private readonly unitOfWork: TaskKnowledgeUnitOfWork) {}

  async authorize(rawToken: string, documentRef?: string): Promise<AgentReadScope> {
    if (typeof rawToken !== "string" || rawToken.length === 0) throw new CredentialInvalidError();
    const tokenHash = hashExportToken(rawToken);
    return this.unitOfWork.run(async (r) => {
      const credential = await r.taskExports.findCredentialByHash(tokenHash);
      if (!credential || credential.status !== "ACTIVE") throw new CredentialInvalidError();
      const binding = await r.taskExports.getBinding(credential.bindingId);
      if (!binding || binding.status !== "ACTIVE") throw new CredentialInvalidError();
      const workspace = await r.workspaces.lockSharedById(binding.workspaceId);
      if (!workspace || workspace.kind !== "PERSONAL" || workspace.status !== "ACTIVE" || workspace.ownerUserId !== binding.ownerUserId) throw new ScopeDeniedError();
      const identity = await r.users.getIdentity(binding.ownerUserId);
      if (!identity) throw new CredentialInvalidError();
      const caller: CallerContext = {
        identity, identitySynced: true, personalWorkspaceOnly: workspace.workspaceId, validatedExternalGroupIds: [], platformCapabilities: [],
      };
      let documentId: string | null = null;
      if (documentRef !== undefined) {
        if (UUID.test(documentRef)) documentId = documentRef;
        else {
          const ids = await activeDocumentsAtPath(r, workspace.workspaceId, documentRef);
          if (ids.length > 1) throw new AgentDocumentAmbiguousError(ids);
          if (ids.length === 0) throw new AgentDocumentNotFoundError();
          documentId = ids[0];
        }
      }
      return { caller, workspaceId: workspace.workspaceId, bindingId: binding.id, documentId };
    });
  }
}
