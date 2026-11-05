import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ services: vi.fn() }));
vi.mock("@/server/composition", () => ({ applicationServices: mocks.services }));
import { GET as unread } from "@/app/api/review-notifications/unread/route";
import { GET as unreadCount } from "@/app/api/review-notifications/unread-count/route";
import { POST as markRead } from "@/app/api/review-notifications/mark-read/route";
import { GET as shareCounts } from "@/app/api/review-notifications/share-counts/route";
import { GET as inboxGet, POST as inboxPost } from "@/app/api/review-notifications/inbox/route";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
function authed(notifications: unknown[] = []) {
  const markEventRead = vi.fn().mockResolvedValue(undefined);
  const markAllActivityRead = vi.fn().mockResolvedValue(undefined);
  const listUnreadShareCountsForOwner = vi.fn().mockResolvedValue([{ documentId: "d1", unreadCount: 3, latestThreadId: "t1" }]);
  const listInbox = vi.fn().mockResolvedValue({ discussions: [], shared: [], nextCursor: null });
  const markDiscussionRead = vi.fn().mockResolvedValue(undefined);
  mocks.services.mockReturnValue({
    establishTrustedCaller: async () => ({ caller: { identity: { id: "owner-1" } } }),
    reviews: {
      listUnreadForOwner: async () => ({ notifications }),
      countUnreadForOwner: async () => ({ count: notifications.length }),
      markDocumentRead: async () => {},
      markEventRead, markAllActivityRead, listUnreadShareCountsForOwner,
      listInbox, markDiscussionRead,
    },
  });
  return { markEventRead, markAllActivityRead, listUnreadShareCountsForOwner, listInbox, markDiscussionRead };
}
describe("review notification routes", () => {
  it("GET unread returns the owner's notifications", async () => {
    authed([{ id: "e1" }]);
    const response = await unread(new Request("http://127.0.0.1:3000/api/review-notifications/unread"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ notifications: [{ id: "e1" }] });
  });
  it("GET unread-count returns a number and no notification", async () => {
    authed([{ id: "e1", body: "PRIVATE" }]);
    const response = await unreadCount(new Request("http://127.0.0.1:3000/api/review-notifications/unread-count"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ count: 1 });
  });
  it("GET unread-count refuses a signed-out caller", async () => {
    mocks.services.mockReturnValue({ establishTrustedCaller: async () => { const { AuthRequiredError } = await import("@/modules/identity/domain/identity-session-errors"); throw new AuthRequiredError(); } });
    const response = await unreadCount(new Request("http://127.0.0.1:3000/api/review-notifications/unread-count"));
    expect(response.status).toBe(401);
  });
  it("POST mark-read rejects a missing documentId", async () => {
    authed();
    const response = await markRead(new Request("http://127.0.0.1:3000/api/review-notifications/mark-read", { method: "POST", headers: { Origin: "http://127.0.0.1:3000" }, body: JSON.stringify({}) }));
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain("INVALID_REQUEST");
  });
  it("POST mark-read accepts a documentId", async () => {
    authed();
    const response = await markRead(new Request("http://127.0.0.1:3000/api/review-notifications/mark-read", { method: "POST", headers: { Origin: "http://127.0.0.1:3000" }, body: JSON.stringify({ documentId: "d1" }) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
  it("GET share counts returns grouped owner unread counts without accepting another recipient", async () => {
    const stubs = authed();
    const response = await shareCounts(new Request("http://127.0.0.1:3000/api/review-notifications/share-counts?recipientUserId=someone-else"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ counts: [{ documentId: "d1", unreadCount: 3, latestThreadId: "t1" }] });
    expect(stubs.listUnreadShareCountsForOwner).toHaveBeenCalledWith(expect.objectContaining({ identity: { id: "owner-1" } }));
  });
  const thread = "0193a7c4-5b6d-7e8f-9a0b-1c2d3e4f5a6b";
  it("GET inbox passes the tab, filters and cursor to the service", async () => {
    const stubs = authed();
    const response = await inboxGet(new Request(`http://127.0.0.1:3000/api/review-notifications/inbox?kind=follow&status=open&unread=1&beforeLatestAt=2026-11-04T00:00:00.000Z&beforeThreadId=${thread}`));
    expect(response.status).toBe(200);
    expect(stubs.listInbox).toHaveBeenCalledWith(expect.objectContaining({ identity: { id: "owner-1" } }), {
      kind: "follow", status: "open", unread: true, before: { latestAt: new Date("2026-11-04T00:00:00.000Z"), threadId: thread },
    });
  });
  it("GET inbox defaults to every tab, every status and read as well as unread", async () => {
    const stubs = authed();
    expect((await inboxGet(new Request("http://127.0.0.1:3000/api/review-notifications/inbox"))).status).toBe(200);
    expect(stubs.listInbox).toHaveBeenCalledWith(expect.anything(), { kind: "all", status: "all", unread: false });
  });
  it("GET inbox rejects a partial or invalid cursor and a bad tab", async () => {
    authed();
    expect((await inboxGet(new Request(`http://127.0.0.1:3000/api/review-notifications/inbox?beforeThreadId=${thread}`))).status).toBe(400);
    expect((await inboxGet(new Request(`http://127.0.0.1:3000/api/review-notifications/inbox?beforeLatestAt=2026-11-04T00:00:00.000Z`))).status).toBe(400);
    expect((await inboxGet(new Request(`http://127.0.0.1:3000/api/review-notifications/inbox?beforeLatestAt=not-a-date&beforeThreadId=${thread}`))).status).toBe(400);
    expect((await inboxGet(new Request(`http://127.0.0.1:3000/api/review-notifications/inbox?beforeLatestAt=2026-99-99T00:00:00.000Z&beforeThreadId=${thread}`))).status).toBe(400);
    expect((await inboxGet(new Request("http://127.0.0.1:3000/api/review-notifications/inbox?beforeLatestAt=2026-11-04T00:00:00.000Z&beforeThreadId=t1"))).status).toBe(400);
    expect((await inboxGet(new Request("http://127.0.0.1:3000/api/review-notifications/inbox?kind=nope"))).status).toBe(400);
    expect((await inboxGet(new Request("http://127.0.0.1:3000/api/review-notifications/inbox?status=nope"))).status).toBe(400);
  });
  it("GET inbox looks up one thread for a deep link", async () => {
    const stubs = authed();
    expect((await inboxGet(new Request("http://127.0.0.1:3000/api/review-notifications/inbox?threadId=t1"))).status).toBe(200);
    expect(stubs.listInbox).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ threadId: "t1" }));
    expect((await inboxGet(new Request("http://127.0.0.1:3000/api/review-notifications/inbox?threadId="))).status).toBe(400);
    expect((await inboxGet(new Request(`http://127.0.0.1:3000/api/review-notifications/inbox?threadId=${"x".repeat(129)}`))).status).toBe(400);
  });
  it("POST inbox marks a thread read, a shared row read, or everything", async () => {
    const stubs = authed();
    const post = (body: unknown) => inboxPost(new Request("http://127.0.0.1:3000/api/review-notifications/inbox", {
      method: "POST", headers: { Origin: "http://127.0.0.1:3000" }, body: JSON.stringify(body),
    }));
    expect((await post({ action: "mark-thread-read", threadId: thread })).status).toBe(200);
    expect(stubs.markDiscussionRead).toHaveBeenCalledWith(expect.anything(), thread);
    expect((await post({ action: "mark-read", eventId: "shared:l1" })).status).toBe(200);
    expect(stubs.markEventRead).toHaveBeenCalledWith(expect.anything(), "shared:l1");
    expect((await post({ action: "mark-all-read" })).status).toBe(200);
    expect(stubs.markAllActivityRead).toHaveBeenCalledTimes(1);
    expect((await post({ action: "mark-thread-read" })).status).toBe(400);
    expect((await post({ action: "mark-thread-read", threadId: "" })).status).toBe(400);
    expect((await post({ action: "mark-thread-read", threadId: "x".repeat(129) })).status).toBe(400);
    expect((await post({ action: "mark-read" })).status).toBe(400);
    expect((await post({ action: "nope" })).status).toBe(400);
  });
});
