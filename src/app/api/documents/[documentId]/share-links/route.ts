import { DomainError } from "@/shared/domain/errors";
import { workspaceHttp } from "@/server/workspace-http";

type ShareLinksRouteContext = { params: Promise<{ documentId: string }> };

/** Share-link spec §9.4: returns a path, never an absolute URL built from a spoofable Host. */
export async function POST(request: Request, context: ShareLinksRouteContext) {
  return workspaceHttp(async (services, caller) => {
    const { documentId } = await context.params;
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new DomainError("INVALID_REQUEST", "Provide a JSON object.");
    const { label, expiresInDays } = body as Record<string, unknown>;
    return { link: await services.shares.create(caller, { documentId, label, expiresInDays }) };
  }, 201);
}

export async function GET(_request: Request, context: ShareLinksRouteContext) {
  return workspaceHttp(async (services, caller) => {
    const { documentId } = await context.params;
    return { links: await services.shares.list(caller, documentId) };
  });
}
