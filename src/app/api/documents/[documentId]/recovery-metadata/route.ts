import { DomainError } from "@/shared/domain/errors";
import { workspaceHttp } from "@/server/workspace-http";

export async function GET(request: Request, context: { params: Promise<{ documentId: string }> }) {
  return workspaceHttp(async (services, caller) => {
    const raw = new URL(request.url).searchParams.get("revision");
    const revisionNo = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(revisionNo) || revisionNo < 1) throw new DomainError("INVALID_REQUEST", "Choose a valid revision.");
    const { documentId } = await context.params;
    const revision = await services.queries.getRevision(caller, documentId, revisionNo, { includeArchived: true });
    return { revisionId: revision.id, metadata: revision.metadata };
  });
}
