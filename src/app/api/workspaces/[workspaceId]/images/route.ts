import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { uploadImage } from "@/server/source-images";
import { workspaceHttp, type WorkspaceRouteContext } from "@/server/workspace-http";

/**
 * An image for a note that is not saved yet (hub image upload spec §4). It goes
 * where the note will: the Workspace's default Hub Source, created here if this
 * is the first thing written, with the authorization that first save would need.
 */
export async function POST(request: Request, context: WorkspaceRouteContext) {
  return workspaceHttp(async (services, caller) => {
    if (!services.sourceImages) return uploadImage(services, caller, request, "");
    const sourceId = await ensureDefaultHubSource(services.unitOfWork, caller, (await context.params).workspaceId);
    return uploadImage(services, caller, request, sourceId);
  }, 201);
}
