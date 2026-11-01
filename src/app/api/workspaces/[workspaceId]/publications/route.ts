import {
  publicationHttp,
  workspaceIdOf,
  type WorkspacePublicationsRouteContext,
} from "@/server/publication-http";

export async function GET(request: Request, context: WorkspacePublicationsRouteContext) {
  return publicationHttp(async (services, caller) => {
    const workspaceId = await workspaceIdOf(context);
    const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "true";
    return services.publications.list(caller, workspaceId, includeArchived);
  });
}
