import { uploadImage } from "@/server/source-images";
import { workspaceHttp } from "@/server/workspace-http";

/** An image for a saved Hub page (hub image upload spec §4). */
export async function POST(request: Request, context: { params: Promise<{ sourceId: string }> }) {
  return workspaceHttp(async (services, caller) => uploadImage(services, caller, request, (await context.params).sourceId), 201);
}
