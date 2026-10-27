import { DomainError } from "@/shared/domain/errors";
import { workspaceHttp } from "@/server/workspace-http";

type DocumentRouteContext = { params: Promise<{ documentId: string }> };

/** Sets or clears the page icon. The icon is presentation; no revision is written. */
export async function PUT(request: Request, context: DocumentRouteContext) {
  return workspaceHttp(async (services, caller) => {
    const { documentId } = await context.params;
    const body: unknown = await request.json().catch(() => null);
    const icon = body && typeof body === "object" && !Array.isArray(body) && "icon" in body
      ? (body as { icon: unknown }).icon
      : undefined;
    if (icon !== null && typeof icon !== "string") {
      throw new DomainError("INVALID_REQUEST", "Provide icon as a string, or null to remove it.");
    }
    return services.hub.setDocumentIcon(caller, documentId, icon);
  });
}
