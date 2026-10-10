import { afterEach, expect, test, vi } from "vitest";
import { reviewRequest } from "@/components/knowledge/review-thread-list";

afterEach(() => vi.unstubAllGlobals());
test("review client refuses HTML login redirects instead of parsing or displaying them", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>IdP login</html>", { headers: { "content-type": "text/html" } })));
  await expect(reviewRequest("/api/share-review/threads/query", {})).rejects.toThrow("unexpected response");
});
test("review client sends no-store same-origin requests and denies fetch redirects", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response("{}", { headers: { "content-type": "application/json" } })); vi.stubGlobal("fetch", fetcher);
  await reviewRequest("/api/share-review/threads/query", { token: "test" });
  expect(fetcher).toHaveBeenCalledWith("/api/share-review/threads/query", expect.objectContaining({ cache: "no-store", credentials: "same-origin", referrerPolicy: "origin", redirect: "error" }));
});
