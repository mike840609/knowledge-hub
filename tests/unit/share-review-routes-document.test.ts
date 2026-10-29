import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every share-review route carries the document a folder link's page is reading (folder share
 * spec §6) through to the service, which judges it; a document link's page sends none.
 */
const mocks = vi.hoisted(() => ({ reviews: {} as Record<string, ReturnType<typeof vi.fn>>, caller: { identity: { id: "reader" } } }));
vi.mock("@/server/composition", () => ({
  applicationServices: () => ({ reviews: mocks.reviews, establishTrustedCaller: async () => ({ caller: mocks.caller }) }),
  reviewReadService: () => mocks.reviews,
}));
import { POST as create } from "@/app/api/share-review/threads/route";
import { POST as query } from "@/app/api/share-review/threads/query/route";
import { POST as follow } from "@/app/api/share-review/threads/[threadId]/follow/route";
import { POST as reply } from "@/app/api/share-review/threads/[threadId]/replies/route";
import { POST as seen } from "@/app/api/share-review/threads/[threadId]/seen/route";
import { POST as remove } from "@/app/api/share-review/threads/[threadId]/comments/[commentId]/deletion/route";
import { POST as edit } from "@/app/api/share-review/threads/[threadId]/comments/[commentId]/body/route";

const URL_BASE = "http://127.0.0.1:3000/api/share-review/threads";
const DOCUMENT = "0192f3a4-0000-7000-8000-000000000002";
const post = (body: unknown) => new Request(URL_BASE, { method: "POST", headers: { Origin: "http://127.0.0.1:3000", "content-type": "application/json" }, body: JSON.stringify(body) });
const thread = { params: Promise.resolve({ threadId: "t1" }) };
const comment = { params: Promise.resolve({ threadId: "t1", commentId: "c1" }) };

beforeEach(() => {
  vi.stubEnv("KM_PUBLIC_ORIGIN", "");
  for (const name of ["createForLink", "queryForLink", "followForLink", "replyForLink", "markSeenForLink", "deleteForLink", "editForLink"]) mocks.reviews[name] = vi.fn(async () => ({}));
});
afterEach(() => vi.unstubAllEnvs());

/** Each route: how to call it with a body, the service method it reaches, and where that method finds `documentId`. */
const routes: [string, (body: Record<string, unknown>) => Promise<Response>, string, (call: unknown[]) => unknown][] = [
  ["create", body => create(post({ expectedRevisionId: "r", anchor: {}, body: "b", idempotencyKey: "k", ...body })), "createForLink", call => (call[1] as { documentId?: string }).documentId],
  ["query", body => query(post(body)), "queryForLink", call => call[2]],
  ["follow", body => follow(post({ following: true, ...body }), thread), "followForLink", call => (call[1] as { documentId?: string }).documentId],
  ["reply", body => reply(post({ body: "b", idempotencyKey: "k", ...body }), thread), "replyForLink", call => (call[1] as { documentId?: string }).documentId],
  ["seen", body => seen(post(body), thread), "markSeenForLink", call => (call[1] as { documentId?: string }).documentId],
  ["delete", body => remove(post(body), comment), "deleteForLink", call => (call[1] as { documentId?: string }).documentId],
  ["edit", body => edit(post({ body: "b", ...body }), comment), "editForLink", call => (call[1] as { documentId?: string }).documentId],
];

describe.each(routes)("the %s route", (_name, call, method, documentIdOf) => {
  it("passes the document a folder link's page names", async () => {
    const response = await call({ token: "tok", documentId: DOCUMENT });
    expect(response.status).toBeLessThan(300);
    expect(mocks.reviews[method]).toHaveBeenCalledTimes(1);
    expect(documentIdOf(mocks.reviews[method].mock.calls[0])).toBe(DOCUMENT);
  });

  it("passes none when the page names none, as a document link's page does", async () => {
    const response = await call({ token: "tok" });
    expect(response.status).toBeLessThan(300);
    expect(documentIdOf(mocks.reviews[method].mock.calls[0])).toBeUndefined();
  });

  it("refuses a document that is not a string as a malformed request, before reaching the service", async () => {
    for (const documentId of [7, null, [DOCUMENT]]) {
      const response = await call({ token: "tok", documentId });
      expect(response.status, JSON.stringify(documentId)).toBe(400);
    }
    expect(mocks.reviews[method]).not.toHaveBeenCalled();
  });
});
