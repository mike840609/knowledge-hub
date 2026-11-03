import { DomainError } from "@/shared/domain/errors";
import { workspaceHttp } from "@/server/workspace-http";

type RecipientsRouteContext = { params: Promise<{ linkId: string }> };

export async function GET(_request: Request, context: RecipientsRouteContext) {
  return workspaceHttp(async (services, caller) => {
    const { linkId } = await context.params;
    return { recipients: await services.shares.listRecipients(caller, linkId) };
  });
}

/** Body `{ userIds: string[] }`; people already named are ignored. */
export async function POST(request: Request, context: RecipientsRouteContext) {
  return workspaceHttp(async (services, caller) => {
    const { linkId } = await context.params;
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new DomainError("INVALID_REQUEST", "Provide a JSON object.");
    await services.shares.addRecipients(caller, linkId, (body as Record<string, unknown>).userIds);
  }, 204);
}
