import { reviewWritesEnabled } from "@/server/config";
import { DomainError } from "@/shared/domain/errors";
import { workspaceHttp } from "@/server/workspace-http";

type SourceShareLinksRouteContext = { params: Promise<{ sourceId: string }> };

/** Same bodies and responses as the document route; a path, never an absolute URL. */
export async function POST(request: Request, context: SourceShareLinksRouteContext) {
  return workspaceHttp(async (services, caller) => {
    const { sourceId } = await context.params;
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new DomainError("INVALID_REQUEST", "Provide a JSON object.");
    const { label, expiresInDays, recipients } = body as Record<string, unknown>;
    return { link: await services.shares.createForSource(caller, { sourceId, label, expiresInDays, recipients }) };
  }, 201);
}

export async function GET(_request: Request, context: SourceShareLinksRouteContext) {
  return workspaceHttp(async (services, caller) => {
    const { sourceId } = await context.params;
    return { links: await services.shares.listForSource(caller, sourceId), reviewReadAvailable: services.reviewReadAvailable, reviewWritesEnabled: reviewWritesEnabled() };
  });
}
