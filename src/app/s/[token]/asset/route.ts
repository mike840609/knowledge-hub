import { configuredBlobStore } from "@/server/blob-store";
import { imageResponse } from "@/server/document-images";
import { getSharedImage } from "@/server/share-read";

export const dynamic = "force-dynamic";

/** Folder-sync images spec §6.4: one 404 for every failure, so no response says whether a file exists. */
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const src = new URL(request.url).searchParams.get("src") ?? "";
  return imageResponse(request, await getSharedImage((await context.params).token, src), configuredBlobStore());
}
