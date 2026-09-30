import { requireRouteId } from "@/server/authoring-input";
import { workspaceHttp } from "@/server/workspace-http";

type LinkTargetsRouteContext = { params: Promise<{ workspaceId: string }> };

/**
 * The documents of this Workspace a `[[wikilink]]` can be written to, for the editor's list of
 * suggestions (daily-driver spec §6.1). Not cached: it is what the caller may link *now*, and a
 * document archived a minute ago must not be offered.
 *
 * The workspace in the path is checked against the caller's membership by the service; knowing it
 * grants nothing.
 */
export async function GET(_request: Request, context: LinkTargetsRouteContext) {
  return workspaceHttp(async (services, caller) => {
    const workspaceId = requireRouteId((await context.params).workspaceId, "the workspace");
    return services.links.listLinkTargets(caller, workspaceId);
  });
}
