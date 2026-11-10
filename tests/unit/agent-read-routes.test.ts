import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextTooLargeError } from "@/modules/knowledge/domain/agent-context";
import { SearchTimeoutError, ValidationError } from "@/modules/knowledge/domain/errors";
import {
  AgentDocumentAmbiguousError,
  AgentDocumentNotFoundError,
  CredentialInvalidError,
  DatabaseUnavailableError,
  ScopeDeniedError,
  TaskSearchUnavailableError,
} from "@/modules/task-knowledge/domain/task-errors";
import { WorkspaceAccessDeniedError, WorkspaceNotFoundError } from "@/modules/workspaces/domain/errors";
import { DomainError, WorkspaceBusyError } from "@/shared/domain/errors";

const injected = vi.hoisted(() => ({
  access: { authorize: vi.fn() },
  search: { search: vi.fn() },
  context: { build: vi.fn() },
  tasks: { list: vi.fn(), get: vi.fn() },
}));
vi.mock("@/server/composition", () => ({
  agentReadServices: () => injected,
  applicationServices: () => {
    throw new Error("the agent routes must not build browser services");
  },
}));

import * as documentsRoute from "@/app/api/agent/documents/route";
import * as searchRoute from "@/app/api/agent/search/route";
import * as tasksRoute from "@/app/api/agent/tasks/route";

const BASE = "https://km.example.com";
const TOKEN = "khx_SECRET-token-value";
const DOC = "0192f3a4-5b6c-7d8e-9f01-23456789abcd";
const TASK = "0192f3a4-5b6c-7d8e-9f01-23456789abce";
const OTHER = "0192f3a4-5b6c-7d8e-9f01-23456789abcf";
const WORKSPACE = "0192f3a4-5b6c-7d8e-9f01-23456789abd0";

const scope = {
  caller: {
    identity: { id: "0192f3a4-5b6c-7d8e-9f01-23456789abd1", emp_id: "E1", name: "Owner", org_code: "ORG" },
    identitySynced: true,
    personalWorkspaceOnly: WORKSPACE,
    validatedExternalGroupIds: [],
    platformCapabilities: [],
  },
  workspaceId: WORKSPACE,
  bindingId: "b1",
  documentId: null,
};

const bundle = { markdown: "# Bundle", bytes: 8, documentCount: 1, threadCount: 0, commentCount: 0, linkCount: 0 };
const detail = {
  taskResultId: TASK,
  lifecycle: "ACTIVE",
  archivedAt: null,
  latestRevisionNo: 1,
  revisionNo: 1,
  revisionHistory: [{ revisionNo: 1, createdAt: new Date() }],
  binding: { label: "laptop", status: "ACTIVE" },
  content: { title: "A task", summary: "", agent: "opencode", status: "completed", completedAt: "2026-11-04T02:15:30.120Z", verification: { status: "passed", checks: [] }, findings: [], decisions: [], changes: [], references: [] },
  references: [],
};

const get = (path: string, headers: Record<string, string> | null = { "x-knowledge-hub-export-token": TOKEN }) =>
  new Request(`${BASE}${path}`, headers ? { headers } : undefined);

let logged: string[];
beforeEach(() => {
  injected.access.authorize.mockReset().mockResolvedValue(scope);
  injected.search.search.mockReset().mockResolvedValue({ terms: ["x"], hits: [], page: 1, hasNext: false, tooLong: false });
  injected.context.build.mockReset().mockResolvedValue(bundle);
  injected.tasks.list.mockReset().mockResolvedValue({ items: [], nextCursor: null });
  injected.tasks.get.mockReset().mockResolvedValue(detail);
  logged = [];
  for (const method of ["log", "warn", "error", "info"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(" ")); });
  }
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function expectPrivate(response: Response) {
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
}

async function searchFor(path: string) {
  return searchRoute.GET(get(path));
}

describe("GET /api/agent/search", () => {
  it("answers document hits and nothing else by default", async () => {
    injected.search.search.mockResolvedValue({
      terms: ["x"], page: 1, hasNext: false, tooLong: false,
      hits: [{ documentId: DOC, title: "Title", sourcePath: "a/b.md", snippet: "a snippet" }],
    });
    const response = await searchFor("/api/agent/search?q=x");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      kind: "documents",
      hits: [{ id: DOC, title: "Title", path: "a/b.md", snippet: "a snippet" }],
      hasMore: false,
    });
    expect(injected.search.search).toHaveBeenCalledWith(scope.caller, {
      q: "x", scope: { kind: "workspace", workspaceId: WORKSPACE }, includeArchived: false, page: 1,
    });
    await expectPrivate(response);
  });

  it("never passes a request value as the workspace", async () => {
    await searchFor(`/api/agent/search?q=x&workspaceId=${OTHER}&workspace=${OTHER}`);
    expect(injected.search.search).toHaveBeenCalledWith(
      scope.caller,
      expect.objectContaining({ scope: { kind: "workspace", workspaceId: scope.workspaceId } }),
    );
    vi.stubEnv("TASK_SEARCH_READ_ENABLED", "true");
    await searchFor(`/api/agent/search?q=x&kind=tasks&workspaceId=${OTHER}&workspace=${OTHER}`);
    expect(injected.tasks.list).toHaveBeenCalledWith(scope.caller, scope.workspaceId, expect.objectContaining({ lifecycle: "ACTIVE" }));
  });

  it("answers task hits, mapping summary to the snippet and path to null", async () => {
    vi.stubEnv("TASK_SEARCH_READ_ENABLED", "true");
    injected.tasks.list.mockResolvedValue({
      items: [{ taskResultId: TASK, title: "A task", summary: "what it found" }], nextCursor: null,
    });
    const response = await searchFor("/api/agent/search?q=x&kind=tasks");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      kind: "tasks",
      hits: [{ id: TASK, title: "A task", path: null, snippet: "what it found" }],
      hasMore: false,
    });
    expect(injected.tasks.list).toHaveBeenCalledWith(scope.caller, scope.workspaceId, {
      lifecycle: "ACTIVE",
      search: expect.objectContaining({ q: "x", terms: ["x"] }),
    });
  });

  it("caps hits at 20 and reports hasMore", async () => {
    injected.search.search.mockResolvedValue({
      terms: ["x"], page: 1, hasNext: false, tooLong: false,
      hits: Array.from({ length: 25 }, (_, index) => ({ documentId: DOC, title: `T${index}`, sourcePath: null, snippet: "s" })),
    });
    const documents = await (await searchFor("/api/agent/search?q=x")).json();
    expect(documents.hits).toHaveLength(20);
    expect(documents.hasMore).toBe(true);

    vi.stubEnv("TASK_SEARCH_READ_ENABLED", "true");
    injected.tasks.list.mockResolvedValue({
      items: Array.from({ length: 25 }, (_, index) => ({ taskResultId: TASK, title: `T${index}`, summary: "" })), nextCursor: null,
    });
    const tasks = await (await searchFor("/api/agent/search?q=x&kind=tasks")).json();
    expect(tasks.hits).toHaveLength(20);
    expect(tasks.hasMore).toBe(true);
  });

  it.each([
    ["an empty q", "/api/agent/search?q="],
    ["a missing q", "/api/agent/search"],
    ["a q over 200 characters", `/api/agent/search?q=${"x".repeat(201)}`],
    ["an unknown kind", "/api/agent/search?q=x&kind=wiki"],
  ])("answers 422 for %s", async (_name, path) => {
    const response = await searchFor(path);
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
    expect(injected.access.authorize).not.toHaveBeenCalled();
    await expectPrivate(response);
  });

  it("answers 422 for a service validation failure", async () => {
    injected.search.search.mockRejectedValue(new ValidationError("Narrow the query."));
    const response = await searchFor("/api/agent/search?q=x");
    expect(response.status).toBe(422);
    expect((await response.json()).error.message).toBe("Narrow the query.");
  });
});

describe("GET /api/agent/documents", () => {
  it("asks for a bundle of one document without discussions", async () => {
    injected.access.authorize.mockResolvedValue({ ...scope, documentId: DOC });
    const response = await documentsRoute.GET(get(`/api/agent/documents?ref=${DOC}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ documentId: DOC, markdown: "# Bundle" });
    expect(injected.access.authorize).toHaveBeenCalledWith(TOKEN, DOC);
    expect(injected.context.build).toHaveBeenCalledWith(scope.caller, WORKSPACE, [DOC], BASE, { includeDiscussions: false });
    await expectPrivate(response);
  });

  it.each([
    ["an empty ref", "/api/agent/documents?ref="],
    ["a missing ref", "/api/agent/documents"],
    ["a ref over 1,024 characters", `/api/agent/documents?ref=${"x".repeat(1025)}`],
  ])("answers 422 for %s", async (_name, path) => {
    const response = await documentsRoute.GET(get(path));
    expect(response.status).toBe(422);
    expect(injected.access.authorize).not.toHaveBeenCalled();
    await expectPrivate(response);
  });

  it("answers 413 when the bundle is too large", async () => {
    injected.access.authorize.mockResolvedValue({ ...scope, documentId: DOC });
    injected.context.build.mockRejectedValue(new ContextTooLargeError("Too large."));
    const response = await documentsRoute.GET(get(`/api/agent/documents?ref=${DOC}`));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: { code: "CONTENT_TOO_LARGE", message: "Too large." } });
  });

  it("answers 409 with the candidate document IDs for an ambiguous path", async () => {
    injected.access.authorize.mockRejectedValue(new AgentDocumentAmbiguousError([DOC, OTHER]));
    const response = await documentsRoute.GET(get("/api/agent/documents?ref=dup.md"));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "AMBIGUOUS", message: expect.any(String), candidateDocumentIds: [DOC, OTHER] },
    });
  });

  it.each([
    ["DOCUMENT_NOT_FOUND", new AgentDocumentNotFoundError()],
    ["TASK_RESULT_NOT_FOUND", new DomainError("TASK_RESULT_NOT_FOUND", "Task result not found.")],
    ["WORKSPACE_NOT_FOUND", new WorkspaceNotFoundError()],
    ["WORKSPACE_ACCESS_DENIED", new WorkspaceAccessDeniedError()],
  ])("answers 404 with one message for %s", async (_name, error) => {
    injected.access.authorize.mockRejectedValue(error);
    const response = await documentsRoute.GET(get("/api/agent/documents?ref=missing.md"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "NOT_FOUND", message: "Not found." } });
  });
});

describe("GET /api/agent/tasks", () => {
  it("answers one Task Result's latest revision", async () => {
    const response = await tasksRoute.GET(get(`/api/agent/tasks?id=${TASK}`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ taskResultId: TASK, revisionNo: 1, content: detail.content, references: [] });
    expect(injected.access.authorize).toHaveBeenCalledWith(TOKEN, undefined);
    expect(injected.tasks.get).toHaveBeenCalledWith(scope.caller, WORKSPACE, TASK);
    await expectPrivate(response);
  });

  it("answers 404 for an ARCHIVED Task Result", async () => {
    injected.tasks.get.mockResolvedValue({ ...detail, lifecycle: "ARCHIVED", archivedAt: new Date() });
    const response = await tasksRoute.GET(get(`/api/agent/tasks?id=${TASK}`));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "NOT_FOUND", message: "Not found." } });
    await expectPrivate(response);
  });

  it.each([
    ["a missing id", "/api/agent/tasks"],
    ["an empty id", "/api/agent/tasks?id="],
    ["an id that is not a UUID", "/api/agent/tasks?id=not-a-uuid"],
  ])("answers 422 for %s", async (_name, path) => {
    const response = await tasksRoute.GET(get(path));
    expect(response.status).toBe(422);
    expect(injected.access.authorize).not.toHaveBeenCalled();
  });

  it("answers 422 for a service validation failure", async () => {
    injected.tasks.get.mockRejectedValue(new ValidationError("Bad task."));
    expect((await tasksRoute.GET(get(`/api/agent/tasks?id=${TASK}`))).status).toBe(422);
  });
});

describe("every route's credential and errors", () => {
  it("answers 401 without calling any service when the header is missing", async () => {
    for (const [route, path] of [
      [searchRoute, "/api/agent/search?q=x"],
      [documentsRoute, `/api/agent/documents?ref=${DOC}`],
      [tasksRoute, `/api/agent/tasks?id=${TASK}`],
    ] as const) {
      const response = await route.GET(get(path, {}));
      expect(response.status).toBe(401);
      await expectPrivate(response);
    }
    expect(injected.access.authorize).not.toHaveBeenCalled();
    expect(injected.search.search).not.toHaveBeenCalled();
    expect(injected.context.build).not.toHaveBeenCalled();
    expect(injected.tasks.list).not.toHaveBeenCalled();
    expect(injected.tasks.get).not.toHaveBeenCalled();
  });

  it("answers 401 for an unknown credential", async () => {
    injected.access.authorize.mockRejectedValue(new CredentialInvalidError());
    const response = await searchFor("/api/agent/search?q=x");
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("CREDENTIAL_INVALID");
    await expectPrivate(response);
  });

  it("answers 403 when the scope no longer allows reads", async () => {
    injected.access.authorize.mockRejectedValue(new ScopeDeniedError());
    const response = await searchFor("/api/agent/search?q=x");
    expect(response.status).toBe(403);
    await expectPrivate(response);
  });

  it.each([
    ["TASK_SEARCH_UNAVAILABLE", new TaskSearchUnavailableError()],
    ["DATABASE_UNAVAILABLE", new DatabaseUnavailableError()],
    ["WORKSPACE_BUSY", new WorkspaceBusyError()],
    ["SEARCH_TIMEOUT", new SearchTimeoutError()],
  ])("answers 503 for %s", async (code, error) => {
    injected.search.search.mockRejectedValue(error);
    const response = await searchFor("/api/agent/search?q=x");
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe(code);
    await expectPrivate(response);
  });

  it("answers 503 and no rows for kind=tasks while the flag is off", async () => {
    vi.stubEnv("TASK_SEARCH_READ_ENABLED", "false");
    const response = await searchFor("/api/agent/search?q=x&kind=tasks");
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe("TASK_SEARCH_UNAVAILABLE");
    expect(body.hits).toBeUndefined();
    expect(injected.tasks.list).not.toHaveBeenCalled();
    await expectPrivate(response);
  });

  it("answers 500 for an unexpected error and logs the class name only", async () => {
    injected.search.search.mockRejectedValue(new TypeError(`driver said ${TOKEN} SECRET-QUERY`));
    const response = await searchFor("/api/agent/search?q=SECRET-QUERY");
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain("SECRET-QUERY");
    expect(logged.join("\n")).toContain("TypeError");
    for (const output of [text, ...logged]) {
      expect(output).not.toContain(TOKEN);
      expect(output).not.toContain("SECRET-QUERY");
    }
    await expectPrivate(response);
  });

  it("answers 405 to POST, PUT, PATCH and DELETE on all three routes", async () => {
    for (const [route, path] of [
      [searchRoute, "/api/agent/search?q=x"],
      [documentsRoute, `/api/agent/documents?ref=${DOC}`],
      [tasksRoute, `/api/agent/tasks?id=${TASK}`],
    ] as const) {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
        const handler = (route as unknown as Record<string, (request: Request) => Promise<Response>>)[method];
        const response = await handler(new Request(`${BASE}${path}`, { method }));
        expect(response.status).toBe(405);
        expect(response.headers.get("Allow")).toBe("GET");
        await expectPrivate(response);
      }
    }
  });
});
