import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ services: vi.fn() }));
vi.mock("@/server/composition", () => ({ applicationServices: mocks.services }));
import { GET as unread } from "@/app/api/review-notifications/unread/route";
import { POST as markRead } from "@/app/api/review-notifications/mark-read/route";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
function authed(notifications: unknown[] = []) {
  mocks.services.mockReturnValue({
    establishTrustedCaller: async () => ({ caller: { identity: { id: "owner-1" } } }),
    reviews: {
      listUnreadForOwner: async () => ({ notifications }),
      markDocumentRead: async () => {},
    },
  });
}
describe("review notification routes", () => {
  it("GET unread returns the owner's notifications", async () => {
    authed([{ id: "e1" }]);
    const response = await unread(new Request("http://127.0.0.1:3000/api/review-notifications/unread"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ notifications: [{ id: "e1" }] });
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
});
