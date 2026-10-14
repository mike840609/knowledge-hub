import { NextResponse } from "next/server";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { MAX_UPLOADED_IMAGE_BYTES } from "@/modules/sources/application/upload-source-image";
import { DEFAULT_HUB_SOURCE_NAME } from "@/modules/sources/application/ensure-default-hub-source";
import { applicationServices } from "./composition";

const refuse = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status });

/** One uploaded image, for both upload routes: the limits a request must meet before its body is read, then the service. */
export async function uploadImage(services: ReturnType<typeof applicationServices>, caller: CallerContext, request: Request, sourceId: string) {
  if (!services.sourceImages) return refuse(404, "IMAGE_STORAGE_NOT_CONFIGURED", "This server does not store images.");
  const declared = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(declared) || declared <= 0) return refuse(400, "INVALID_REQUEST", "An image upload needs a body and its length.");
  if (declared > MAX_UPLOADED_IMAGE_BYTES) return refuse(413, "IMAGE_TOO_LARGE", "An image can be at most 10 MiB.");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_UPLOADED_IMAGE_BYTES) return refuse(413, "IMAGE_TOO_LARGE", "An image can be at most 10 MiB.");
  return services.sourceImages.upload(caller, { sourceId, bytes });
}

/**
 * The Source a new note's images are read from, when the Workspace already has
 * its Notes. A lookup: opening the new-note page creates nothing. Null also
 * when the caller cannot list the Workspace's Sources.
 */
export async function findDefaultHubSourceId(workspaceId: string): Promise<string | null> {
  try {
    const services = applicationServices();
    const { caller } = await services.establishTrustedCaller();
    const sources = await services.queries.listSources(caller, workspaceId);
    return sources.find((source) => source.sourceType === "HUB" && source.status === "ACTIVE" && source.name === DEFAULT_HUB_SOURCE_NAME)?.id ?? null;
  } catch {
    return null;
  }
}
