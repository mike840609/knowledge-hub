import { afterEach, expect, test, vi } from "vitest";
import { ReviewRequestError, reviewRequest } from "@/components/knowledge/review-thread-list";

afterEach(() => vi.unstubAllGlobals());
test("review client refuses HTML login redirects instead of parsing or displaying them", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>IdP login</html>", { headers: { "content-type": "text/html" } })));
  await expect(reviewRequest("/api/share-review/threads/query", {})).rejects.toThrow("unexpected response");
});
test("review client sends no-store same-origin requests and never follows a redirect", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response("{}", { headers: { "content-type": "application/json" } })); vi.stubGlobal("fetch", fetcher);
  await reviewRequest("/api/share-review/threads/query", { token: "test" });
  expect(fetcher).toHaveBeenCalledWith("/api/share-review/threads/query", expect.objectContaining({ cache: "no-store", credentials: "same-origin", referrerPolicy: "origin", redirect: "manual" }));
});

test("a redirect is handed back unread and refused as an expired sign-in, never followed or parsed", async () => {
  const redirected = { type: "opaqueredirect", status: 0, ok: false, headers: new Headers(), json: vi.fn() };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(redirected));
  const failure = await reviewRequest("/api/share-review/threads", {}).catch(error => error);
  expect(failure).toBeInstanceOf(ReviewRequestError);
  expect(failure).toMatchObject({ status: 0, code: "REDIRECTED", message: "Your sign-in has expired. Sign in again." });
  expect(redirected.json).not.toHaveBeenCalled();
});

test("a request that got no answer, and each refusal, carry their status and code", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
  await expect(reviewRequest("/api/share-review/threads", {})).rejects.toMatchObject({ status: 0, code: "NETWORK" });
  const answer = (status: number, body: unknown) => vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })));
  answer(409, { error: { code: "STALE_DOCUMENT_REVISION", message: "Refresh the document before selecting a passage." } });
  await expect(reviewRequest("/api/share-review/threads", {})).rejects.toMatchObject({ status: 409, code: "STALE_DOCUMENT_REVISION", message: "Refresh the document before selecting a passage." });
  answer(401, { error: { code: "AUTH_REQUIRED", message: "x" } });
  await expect(reviewRequest("/api/share-review/threads", {})).rejects.toMatchObject({ status: 401, code: "AUTH_REQUIRED", message: "Your sign-in has expired. Sign in again." });
  answer(500, { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } });
  await expect(reviewRequest("/api/share-review/threads", {})).rejects.toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
});
