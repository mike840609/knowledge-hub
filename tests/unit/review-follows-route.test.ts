import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ services: vi.fn() }));
vi.mock("@/server/composition", () => ({ applicationServices: mocks.services, reviewReadService: vi.fn() }));
import { POST } from "@/app/api/review-follows/[threadId]/unfollow/route";
import { AuthRequiredError } from "@/modules/identity/domain/identity-session-errors";
afterEach(() => vi.clearAllMocks());
const origin = "http://127.0.0.1:3000";
const call = (headers: Record<string, string> = { Origin: origin }) =>
  POST(new Request(`${origin}/api/review-follows/t1/unfollow`, { method: "POST", headers }), { params: Promise.resolve({ threadId: "t1" }) });

describe("stopping one's own follow", () => {
  it("answers for the trusted caller's own follow", async () => {
    const unfollowOwn = vi.fn().mockResolvedValue({ following: false });
    mocks.services.mockReturnValue({ establishTrustedCaller: async () => ({ caller: { identity: { id: "reader" } } }), reviews: { unfollowOwn } });
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ following: false });
    expect(unfollowOwn).toHaveBeenCalledWith({ identity: { id: "reader" } }, "t1");
  });
  it("refuses without a caller", async () => {
    mocks.services.mockReturnValue({ establishTrustedCaller: async () => { throw new AuthRequiredError(); }, reviews: { unfollowOwn: vi.fn() } });
    expect((await call()).status).toBe(401);
  });
  it("refuses a request from another origin", async () => {
    const unfollowOwn = vi.fn();
    mocks.services.mockReturnValue({ establishTrustedCaller: async () => ({ caller: { identity: { id: "reader" } } }), reviews: { unfollowOwn } });
    expect((await call({ Origin: "https://evil.example" })).status).toBe(403);
    expect(unfollowOwn).not.toHaveBeenCalled();
  });
});
