import { reviewBody, reviewHttp } from "@/server/review-http";
import { DomainError } from "@/shared/domain/errors";
import { isUuid } from "@/shared/ids/uuid";
import type { InboxKindFilter, InboxStatusFilter } from "@/modules/knowledge/domain/inbox-discussion";

// Request-bound private review routes must bypass Next auto-mode Request proxies.
export const dynamic = "force-dynamic";

const ID_LIMIT = 128;
const KINDS: readonly string[] = ["all", "owner", "follow", "mention"];
const STATUSES: readonly string[] = ["all", "open", "resolved"];

function kind(value: string | null): InboxKindFilter {
  if (value === null) return "all";
  if (!KINDS.includes(value)) throw new DomainError("INVALID_REQUEST", "Choose a valid inbox tab.");
  return value as InboxKindFilter;
}

function status(value: string | null): InboxStatusFilter {
  if (value === null) return "all";
  if (!STATUSES.includes(value)) throw new DomainError("INVALID_REQUEST", "Choose a valid inbox status.");
  return value as InboxStatusFilter;
}

/** Both halves or neither; the thread id is a MariaDB UUID column, so a malformed one is a request error here. */
function cursor(query: URLSearchParams): { latestAt: Date; threadId: string } | undefined {
  const latestAt = query.get("beforeLatestAt");
  const threadId = query.get("beforeThreadId");
  if ((latestAt === null) !== (threadId === null)) throw new DomainError("INVALID_REQUEST", "Provide a complete inbox cursor.");
  if (latestAt === null || threadId === null) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(latestAt) || !Number.isFinite(Date.parse(latestAt)) || !isUuid(threadId)) {
    throw new DomainError("INVALID_REQUEST", "Invalid inbox cursor.");
  }
  return { latestAt: new Date(latestAt), threadId };
}

/** A deep-link lookup need not name a real thread: the service selects nothing for an unknown or malformed id. */
function threadId(query: URLSearchParams): string | undefined {
  const value = query.get("threadId");
  if (value === null) return undefined;
  if (!value || value.length > ID_LIMIT) throw new DomainError("INVALID_REQUEST", "Provide a thread id.");
  return value;
}

function boundedId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= ID_LIMIT;
}

export async function GET(request: Request) {
  return reviewHttp(request, async (service, caller) => {
    const query = new URL(request.url).searchParams;
    const before = cursor(query);
    const single = threadId(query);
    return service.listInbox(caller, {
      kind: kind(query.get("kind")),
      status: status(query.get("status")),
      unread: query.get("unread") === "1",
      ...(before ? { before } : {}),
      ...(single ? { threadId: single } : {}),
    });
  });
}

/** Reading a discussion, one shared comment, or everything never resolves the discussion itself. */
export async function POST(request: Request) {
  return reviewHttp(request, async (service, caller) => {
    const body = await reviewBody(request);
    if (body.action === "mark-all-read") {
      await service.markAllActivityRead(caller);
    } else if (body.action === "mark-thread-read" && boundedId(body.threadId)) {
      await service.markDiscussionRead(caller, body.threadId);
    } else if (body.action === "mark-read" && boundedId(body.eventId)) {
      await service.markEventRead(caller, body.eventId);
    } else {
      throw new DomainError("INVALID_REQUEST", "Choose a discussion, a shared comment, or mark all as read.");
    }
    return { ok: true };
  });
}
