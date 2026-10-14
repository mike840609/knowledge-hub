import { NextResponse } from "next/server";
import { applicationServices } from "@/server/composition";
import { imageResponse } from "@/server/document-images";
import { toWorkspaceErrorResponse } from "@/server/http-error-response";

/**
 * A Source's stored image, for the editor (hub image upload spec §5): a note
 * that is not saved yet has no document to ask through. Readers of a saved page
 * use the document route.
 */
export async function GET(request: Request, context: { params: Promise<{ sourceId: string }> }) {
  try {
    const services = applicationServices();
    const { caller } = await services.establishTrustedCaller();
    const src = new URL(request.url).searchParams.get("src") ?? "";
    const image = await services.documentImages.findInSource(caller, (await context.params).sourceId, src);
    return await imageResponse(request, image, services.blobs);
  } catch (error) {
    const mapped = toWorkspaceErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status, headers: { "Cache-Control": "private, no-store" } });
  }
}
