import { reviewBody, reviewHttp } from "@/server/review-http";
import { DomainError } from "@/shared/domain/errors";

export const dynamic = "force-dynamic";

/** All events are scoped by the trusted caller's personal-workspace ownership. */
export async function GET(request: Request) {
  return reviewHttp(request, async (service, caller) => {
    const query = new URL(request.url).searchParams;
    const at = query.get("beforeCreatedAt");
    const id = query.get("beforeId");
    if ((at === null) !== (id === null)) throw new DomainError("INVALID_REQUEST", "Provide a complete cursor.");
    if (at !== null && (!/^\d{4}-\d{2}-\d{2}T/.test(at) || !Number.isFinite(Date.parse(at)) || !id || id.length > 128)) {
      throw new DomainError("INVALID_REQUEST", "Invalid activity cursor.");
    }
    return service.listActivityForOwner(caller, at && id ? { createdAt: new Date(at), id } : undefined);
  });
}

/** Reading an entry never resolves or modifies its underlying discussion. */
export async function POST(request: Request) {
  return reviewHttp(request, async (service, caller) => {
    const body = await reviewBody(request);
    if (body.action === "mark-all-read") {
      await service.markAllActivityRead(caller);
    } else if (body.action === "mark-read" && typeof body.eventId === "string" && body.eventId.length > 0 && body.eventId.length <= 128) {
      await service.markEventRead(caller, body.eventId);
    } else {
      throw new DomainError("INVALID_REQUEST", "Choose an activity item or mark all as read.");
    }
    return { ok: true };
  });
}
