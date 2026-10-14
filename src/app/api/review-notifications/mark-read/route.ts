// Request-bound private review routes must bypass Next auto-mode Request proxies.
export const dynamic = "force-dynamic";
import { reviewBody, reviewHttp } from "@/server/review-http";
export async function POST(request: Request) {
  return reviewHttp(request, async (service, caller) => {
    const body = await reviewBody(request);
    if (typeof body.documentId !== "string" || !body.documentId) {
      const { DomainError } = await import("@/shared/domain/errors");
      throw new DomainError("INVALID_REQUEST", "Provide a document id.");
    }
    await service.markDocumentRead(caller, body.documentId);
    return { ok: true };
  });
}
