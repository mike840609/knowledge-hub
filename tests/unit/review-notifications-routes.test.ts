import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ services: vi.fn() }));
vi.mock("@/server/composition", () => ({ applicationServices: mocks.services }));
import { GET as unread } from "@/app/api/review-notifications/unread/route";
import { GET as unreadCount } from "@/app/api/review-notifications/unread-count/route";
import { POST as markRead } from "@/app/api/review-notifications/mark-read/route";
import { GET as activity, POST as activityAction } from "@/app/api/review-notifications/activity/route";
import { GET as shareCounts } from "@/app/api/review-notifications/share-counts/route";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
function authed(notifications: unknown[] = []) {
  const markEventRead = vi.fn().mockResolvedValue(undefined);
  const markAllActivityRead = vi.fn().mockResolvedValue(undefined);
  const listActivityForOwner = vi.fn().mockResolvedValue({ notifications, nextCursor: null });
  const listUnreadShareCountsForOwner = vi.fn().mockResolvedValue([{ documentId: "d1", unreadCount: 3, latestThreadId: "t1" }]);
  mocks.services.mockReturnValue({
    establishTrustedCaller: async () => ({ caller: { identity: { id: "owner-1" } } }),
    reviews: {
      listUnreadForOwner: async () => ({ notifications }),
      countUnreadForOwner: async () => ({ count: notifications.length }),
      markDocumentRead: async () => {},
      markEventRead, markAllActivityRead, listActivityForOwner, listUnreadShareCountsForOwner,
    },
  });
  return { markEventRead, markAllActivityRead, listActivityForOwner, listUnreadShareCountsForOwner };
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
  it("GET activity returns read and unread events scoped to the current owner", async () => {
    const mocks = authed([{ id: "e1", readAt: null }, { id: "e2", readAt: "2026-10-15T01:00:00Z" }]);
    const response = await activity(new Request("http://127.0.0.1:3000/api/review-notifications/activity"));
    expect(response.status).toBe(200);
    expect((await response.json()).notifications).toHaveLength(2);
    expect(mocks.listActivityForOwner).toHaveBeenCalledWith(expect.objectContaining({ identity: { id: "owner-1" } }), undefined);
  });
  it("GET activity rejects a partial cursor", async () => {
    authed();
    const response = await activity(new Request("http://127.0.0.1:3000/api/review-notifications/activity?beforeId=e1"));
    expect(response.status).toBe(400);
  });
  it("POST activity marks one event or all events without accepting a recipient id", async () => {
    const mocks = authed();
    const submit = (body: unknown) => activityAction(new Request("http://127.0.0.1:3000/api/review-notifications/activity", {
      method: "POST", headers: { Origin: "http://127.0.0.1:3000" }, body: JSON.stringify(body),
    }));
    expect((await submit({ action: "mark-read", eventId: "e1", recipientUserId: "someone-else" })).status).toBe(200);
    expect(mocks.markEventRead).toHaveBeenCalledWith(expect.objectContaining({ identity: { id: "owner-1" } }), "e1");
    expect((await submit({ action: "mark-all-read" })).status).toBe(200);
    expect(mocks.markAllActivityRead).toHaveBeenCalledTimes(1);
    expect((await submit({ action: "delete", eventId: "e1" })).status).toBe(400);
  });
});
