// Request-bound private review routes must bypass Next auto-mode Request proxies.
export const dynamic = "force-dynamic";
import { reviewBody, reviewHttp } from "@/server/review-http";
/** With a thread, that discussion's notices are read; without one, the whole document's. */
export async function POST(request: Request) {
  return reviewHttp(request, async (service, caller) => {
    const body = await reviewBody(request);
    const { DomainError } = await import("@/shared/domain/errors");
    if (typeof body.documentId !== "string" || !body.documentId) throw new DomainError("INVALID_REQUEST", "Provide a document id.");
    if (body.threadId !== undefined && (typeof body.threadId !== "string" || !body.threadId)) throw new DomainError("INVALID_REQUEST", "Provide a thread id.");
    if (typeof body.threadId === "string") await service.markThreadRead(caller, body.documentId, body.threadId);
    else await service.markDocumentRead(caller, body.documentId);
    return { ok: true };
  });
}
