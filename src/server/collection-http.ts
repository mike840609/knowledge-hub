import { NextResponse } from "next/server";
import { KnowledgeCollectionError } from "@/modules/knowledge/domain/knowledge-collection-errors";
import { applicationServices } from "./composition";
import { toWorkspaceErrorResponse } from "./http-error-response";
import { assertReviewOrigin } from "./review-origin";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { KnowledgeCollectionService } from "@/modules/knowledge/application/knowledge-collection-service";

/** Every collection request requires a trusted caller; mutation origin is checked before the handler. */
export async function collectionHttp(
  request: Request,
  work: (service: KnowledgeCollectionService, caller: CallerContext) => Promise<unknown>,
  status = 200,
): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    if (request.method !== "GET") assertReviewOrigin(request);
    const services = applicationServices();
    const { caller } = await services.establishTrustedCaller();
    const result = await work(services.collections, caller);
    return status === 204
      ? new NextResponse(null, { status, headers })
      : NextResponse.json(result, { status, headers });
  } catch (error) {
    const mapped = toWorkspaceErrorResponse(error);
    if (mapped.status === 500) console.error("Collection request failed.", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json(mapped.body, { status: mapped.status, headers });
  }
}

/** Reject oversized requests and non-object/array bodies before passing values to the domain. */
export async function collectionBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 16_384) throw new KnowledgeCollectionError("COLLECTION_INVALID", "Collection request body too large.");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new KnowledgeCollectionError("COLLECTION_INVALID", "Invalid collection JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new KnowledgeCollectionError("COLLECTION_INVALID", "Invalid collection JSON object.");
  return value as Record<string, unknown>;
}
