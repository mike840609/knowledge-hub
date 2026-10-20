import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ authenticate: vi.fn(), navigation: vi.fn() }));
vi.mock("@/server/composition", () => ({ applicationServices: () => ({ establishTrustedCaller: fixture.authenticate, workspaceAdmin: { navigation: fixture.navigation } }) }));
vi.mock("next/navigation", () => ({ redirect: (destination: string) => { throw new Error(`redirect:${destination}`); } }));
import HomePage from "@/app/page";

beforeEach(() => {
  fixture.authenticate.mockReset().mockResolvedValue({ caller: { personalWorkspaceOnly: "personal" } });
  fixture.navigation.mockReset().mockResolvedValue({ items: [{ type: "PERSONAL", id: "personal" }] });
});

it("continues to the shared document after authentication", async () => {
  await expect(HomePage({ searchParams: Promise.resolve({ returnTo: "/s/share-token/open" }) })).rejects.toThrow("redirect:/s/share-token/open");
});

it("continues to the shared page itself, to comment signed in", async () => {
  await expect(HomePage({ searchParams: Promise.resolve({ returnTo: "/s/share-token" }) })).rejects.toThrow("redirect:/s/share-token");
});

it("does not continue if authentication fails", async () => {
  fixture.authenticate.mockRejectedValue(new Error("not signed in"));
  await expect(HomePage({ searchParams: Promise.resolve({ returnTo: "/s/share-token/open" }) })).rejects.toThrow("not signed in");
});

it.each([undefined, "https://evil.test", "//evil.test", "/\\evil.test", "/s/../open", "/s/%2e%2e/open", "/s/token/open?returnTo=https://evil.test", "/w/other/home", "/s/token/", "/s/token/other", "/s/token?x=1", "/s//evil.test", "/s/", ["/s/token/open", "//evil.test"]])("falls back to the ordinary home for invalid continuation %j", async returnTo => {
  await expect(HomePage({ searchParams: Promise.resolve({ returnTo }) })).rejects.toThrow("redirect:/w/personal/home");
});
