import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CredentialInvalidError,
  DatabaseUnavailableError,
  RevisionConflictError,
  RevisionOutOfOrderError,
  ScopeDeniedError,
  TaskArchivedError,
} from "@/modules/task-knowledge/domain/task-errors";
import { WorkspaceBusyError } from "@/shared/domain/errors";

const injected = vi.hoisted(() => ({ ingest: vi.fn() }));
vi.mock("@/server/composition", () => ({
  taskIngestService: () => ({ ingest: injected.ingest }),
  applicationServices: () => { throw new Error("the ingest route must not build browser services"); },
}));

import * as route from "@/app/api/task-results/ingest/route";

const URL_ = "https://km.example.com/api/task-results/ingest";
const TOKEN = "khx_SECRET-token-value";
const BODY = JSON.stringify({ schemaVersion: 1, summary: "PRIVATE-CONTENT" });
const created = { state: "CREATED", taskResultId: "t1", revisionNo: 1, bindingId: "b1", workspaceId: "w1" };

const post = (body: BodyInit | null = BODY, headers: Record<string, string> = { "x-knowledge-hub-export-token": TOKEN }) =>
  new Request(URL_, { method: "POST", headers: { "content-type": "application/json", ...headers }, body, duplex: "half" } as RequestInit);

function streamOf(bytes: number): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent >= bytes) return controller.close();
      const size = Math.min(8192, bytes - sent);
      controller.enqueue(new Uint8Array(size).fill(0x20));
      sent += size;
    },
  });
}

let logged: string[];
beforeEach(() => {
  injected.ingest.mockReset();
  logged = [];
  for (const method of ["log", "warn", "error", "info"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(" ")); });
  }
});
afterEach(() => vi.restoreAllMocks());

async function expectPrivate(response: Response) {
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  for (const [name] of response.headers) expect(name.toLowerCase().startsWith("access-control-allow")).toBe(false);
}

describe("POST /api/task-results/ingest", () => {
  it("answers 201 for a new revision and 200 for an exact replay, with a relative url", async () => {
    injected.ingest.mockResolvedValueOnce(created).mockResolvedValueOnce({ ...created, state: "EXISTING" });
    const first = await route.POST(post());
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({ taskResultId: "t1", revisionNo: 1, bindingId: "b1", url: "/w/w1/tasks/t1" });
    await expectPrivate(first);
    const replay = await route.POST(post());
    expect(replay.status).toBe(200);
    expect(injected.ingest).toHaveBeenCalledWith(TOKEN, { schemaVersion: 1, summary: "PRIVATE-CONTENT" });
  });

  it.each([
    ["a missing header", {}],
    ["an empty header", { "x-knowledge-hub-export-token": "" }],
    ["a browser session cookie alone", { cookie: "authjs.session-token=abc" }],
    ["an Authorization header alone", { authorization: `Bearer ${TOKEN}` }],
  ])("answers 401 for %s without calling the service", async (_name, headers) => {
    const response = await route.POST(post(BODY, headers));
    expect(response.status).toBe(401);
    expect(injected.ingest).not.toHaveBeenCalled();
    await expectPrivate(response);
  });

  it("answers 401 for an unknown credential", async () => {
    injected.ingest.mockRejectedValue(new CredentialInvalidError());
    expect((await route.POST(post())).status).toBe(401);
  });

  it("answers 413 for a body over 64 KiB with no Content-Length", async () => {
    const response = await route.POST(post(streamOf(65 * 1024 + 1)));
    expect(response.status).toBe(413);
    expect(injected.ingest).not.toHaveBeenCalled();
  });

  it("answers 413 when Content-Length understates the body", async () => {
    const response = await route.POST(post(streamOf(70 * 1024), { "x-knowledge-hub-export-token": TOKEN, "content-length": "10" }));
    expect(response.status).toBe(413);
  });

  it("answers 400 for malformed JSON and 422 for a contract failure", async () => {
    expect((await route.POST(post("{not json"))).status).toBe(400);
    const { TaskArtifactError } = await import("@/modules/task-knowledge/domain/task-errors");
    injected.ingest.mockRejectedValue(new TaskArtifactError("UNSUPPORTED_SCHEMA_VERSION", "schemaVersion: only 1 is supported"));
    const response = await route.POST(post());
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("UNSUPPORTED_SCHEMA_VERSION");
  });

  it.each([
    [new RevisionConflictError(3), { code: "REVISION_CONFLICT", latestRevisionNo: 3 }],
    [new RevisionOutOfOrderError(0), { code: "REVISION_OUT_OF_ORDER", latestRevisionNo: 0 }],
    [new TaskArchivedError(), { code: "TASK_ARCHIVED" }],
  ])("answers 409 for %s", async (error, expected) => {
    injected.ingest.mockRejectedValue(error);
    const response = await route.POST(post());
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatchObject(expected);
  });

  it("answers 403 when the scope no longer allows the write", async () => {
    injected.ingest.mockRejectedValue(new ScopeDeniedError());
    expect((await route.POST(post())).status).toBe(403);
  });

  it.each([new WorkspaceBusyError(), new DatabaseUnavailableError()])("answers 503 for %s", async (error) => {
    injected.ingest.mockRejectedValue(error);
    const response = await route.POST(post());
    expect(response.status).toBe(503);
    await expectPrivate(response);
  });

  it("answers 500 for an unexpected error, never a success, and logs neither token nor content", async () => {
    injected.ingest.mockRejectedValue(new Error(`driver said ${TOKEN} PRIVATE-CONTENT`));
    const response = await route.POST(post());
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain("taskResultId");
    for (const output of [text, ...logged]) {
      expect(output).not.toContain(TOKEN);
      expect(output).not.toContain("PRIVATE-CONTENT");
    }
  });
});

describe("every other method", () => {
  it.each(["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"] as const)("answers %s with 405 and no CORS grant", async (method) => {
    const handler = route[method] as (request: Request) => Promise<Response> | Response;
    expect(typeof handler).toBe("function");
    const response = await handler(new Request(URL_, { method, headers: { origin: "https://evil.example", "access-control-request-method": "POST" } }));
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    await expectPrivate(response);
  });
});
