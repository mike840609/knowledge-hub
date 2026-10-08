import { NextResponse } from "next/server";
import { applicationServices } from "@/server/composition";
import { imageResponse } from "@/server/document-images";
import { toWorkspaceErrorResponse } from "@/server/http-error-response";

// Not workspaceHttp: that forces `no-store`, and an image answers revalidation with a 304.
export async function GET(request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    const services = applicationServices();
    const { caller } = await services.establishTrustedCaller();
    const src = new URL(request.url).searchParams.get("src") ?? "";
    const image = await services.documentImages.find(caller, (await context.params).documentId, src);
    return await imageResponse(request, image, services.blobs);
  } catch (error) {
    const mapped = toWorkspaceErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status, headers: { "Cache-Control": "private, no-store" } });
  }
}
