import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthRequiredError } from "@/modules/identity/domain/identity-session-errors";
import { PublicationAccessDeniedError } from "@/modules/sources/domain/publication-errors";
import { publicationError } from "@/modules/sources/domain/publication-errors";
import { WorkspaceAccessDeniedError } from "@/modules/workspaces/domain/errors";

const caller = { identity: { id: "0199f600-0000-7000-8000-000000000001" } };
const teamId = "0199f600-0000-7000-8000-000000000010";
const publicationId = "0199f600-0000-7000-8000-000000000020";
const folderNodeId = "0199f600-0000-7000-8000-000000000030";

const injected = vi.hoisted(() => ({
  authError: null as unknown,
  caller: null as unknown,
  publications: {
    publish: vi.fn(),
    preview: vi.fn(),
    join: vi.fn(),
    leave: vi.fn(),
    resume: vi.fn(),
    unpublish: vi.fn(),
    restore: vi.fn(),
    rename: vi.fn(),
    list: vi.fn(),
    status: vi.fn(),
  },
}));
vi.mock("@/server/composition", () => ({
  applicationServices: () => ({
    establishTrustedCaller: async () => {
      if (injected.authError !== null) throw injected.authError;
      return { caller: injected.caller };
    },
    publications: injected.publications,
  }),
}));

import { POST as publish } from "@/app/api/publications/route";
import { POST as preview } from "@/app/api/publications/preview/route";
import { POST as join } from "@/app/api/publications/[publicationId]/join/route";
import { POST as leave } from "@/app/api/publications/[publicationId]/leave/route";
import { POST as resume } from "@/app/api/publications/[publicationId]/resume/route";
import { POST as unpublish } from "@/app/api/publications/[publicationId]/unpublish/route";
import { POST as restore } from "@/app/api/publications/[publicationId]/restore/route";
import { POST as rename } from "@/app/api/publications/[publicationId]/rename/route";
import { GET as status } from "@/app/api/publications/[publicationId]/status/route";
import { GET as list } from "@/app/api/workspaces/[workspaceId]/publications/route";

function request(body?: unknown, method = "POST"): Request {
  return new Request("http://hub.test/api", {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });
}
const ofPublication = (id = publicationId) => ({ params: Promise.resolve({ publicationId: id }) });
const ofWorkspace = (id = teamId) => ({ params: Promise.resolve({ workspaceId: id }) });
const publishBody = {
  teamWorkspaceId: teamId,
  name: "HCM KM 設計",
  origin: { kind: "FOLDER", folderNodeId },
};

async function expectError(response: Response, status: number, code: string) {
  const body = await response.json();
  expect({ status: response.status, code: body.error?.code }).toEqual({ status, code });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  return body as { error: { code: string; message: string } };
}

beforeEach(() => {
  vi.stubEnv("KM_TEAM_WORKSPACES_ENABLED", "true");
  injected.caller = caller;
  injected.authError = null;
  for (const method of Object.values(injected.publications)) method.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("publication command routes", () => {
  it("publishes with exactly the caller and the parsed origin", async () => {
    injected.publications.publish.mockResolvedValue({ publicationId, report: { created: 1 } });
    const response = await publish(request(publishBody));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ publicationId, report: { created: 1 } });
    expect(injected.publications.publish).toHaveBeenCalledWith(caller, {
      teamWorkspaceId: teamId,
      name: "HCM KM 設計",
      origin: { kind: "FOLDER", folderNodeId },
    });
  });

  it("previews without writing", async () => {
    const view = {
      nameTaken: false,
      refusedOriginals: [],
      joinSuggestion: null,
      lowOverlapWarning: false,
    };
    injected.publications.preview.mockResolvedValue(view);
    const response = await preview(request(publishBody));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(view);
    expect(injected.publications.preview).toHaveBeenCalledWith(caller, {
      teamWorkspaceId: teamId,
      name: "HCM KM 設計",
      origin: { kind: "FOLDER", folderNodeId },
    });
    expect(injected.publications.publish).not.toHaveBeenCalled();
  });

  it("joins from a folder with an explicit low-overlap acknowledgement", async () => {
    injected.publications.join.mockResolvedValue({ contributionId: publicationId, report: { created: 0 } });
    const response = await join(request({ folderNodeId, acknowledgeLowOverlap: true }), ofPublication());
    expect(response.status).toBe(200);
    expect(injected.publications.join).toHaveBeenCalledWith(caller, {
      publicationId,
      folderNodeId,
      acknowledgeLowOverlap: true,
    });
  });

  it.each([
    ["leave", leave, "leave", 204],
    ["unpublish", unpublish, "unpublish", 204],
    ["restore", restore, "restore", 204],
  ] as const)("%s answers 204 and passes the route ID", async (_name, handler, method, expected) => {
    injected.publications[method].mockResolvedValue(undefined);
    const response = await handler(request(), ofPublication());
    expect(response.status).toBe(expected);
    expect(await response.text()).toBe("");
    expect(injected.publications[method]).toHaveBeenCalledWith(caller, publicationId);
  });

  it("resumes and returns the caller's report", async () => {
    injected.publications.resume.mockResolvedValue({ created: 1, updated: 0, moved: 0, archived: 0, restored: 0, notices: [] });
    const response = await resume(request(), ofPublication());
    expect(response.status).toBe(200);
    expect((await response.json()).created).toBe(1);
  });

  it("renames with the name from the body", async () => {
    injected.publications.rename.mockResolvedValue(undefined);
    const response = await rename(request({ name: " New name " }), ofPublication());
    expect(response.status).toBe(204);
    expect(injected.publications.rename).toHaveBeenCalledWith(caller, publicationId, " New name ");
  });

  it("reads the caller's own status", async () => {
    injected.publications.status.mockResolvedValue({ pending: true, report: null });
    const response = await status(request(undefined, "GET"), ofPublication());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ pending: true, report: null });
    expect(injected.publications.status).toHaveBeenCalledWith(caller, publicationId);
  });

  it("lists a team's publications with the archived switch", async () => {
    injected.publications.list.mockResolvedValue([]);
    const response = await list(new Request(`http://hub.test/api?includeArchived=true`), ofWorkspace());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect(injected.publications.list).toHaveBeenCalledWith(caller, teamId, true);

    await list(new Request("http://hub.test/api"), ofWorkspace());
    expect(injected.publications.list).toHaveBeenLastCalledWith(caller, teamId, false);
  });
});

describe("publication request validation", () => {
  it.each([
    ["a publication ID that is not an ID", () => join(request({ folderNodeId }), ofPublication("not-an-id")), "INVALID_REQUEST"],
    ["a workspace ID that is not an ID", () => list(new Request("http://hub.test/api"), ofWorkspace("not-an-id")), "INVALID_REQUEST"],
    ["a body that is not JSON", () => publish(new Request("http://hub.test/api", { method: "POST", body: "{nope" })), "INVALID_REQUEST"],
    ["a body that is not an object", () => publish(request([publishBody])), "INVALID_REQUEST"],
    ["a missing team", () => publish(request({ name: "A", origin: { kind: "FOLDER", folderNodeId } })), "INVALID_REQUEST"],
    ["a team that is not an ID", () => publish(request({ ...publishBody, teamWorkspaceId: "not-an-id" })), "INVALID_REQUEST"],
    ["a missing name", () => publish(request({ teamWorkspaceId: teamId, origin: { kind: "FOLDER", folderNodeId } })), "INVALID_REQUEST"],
    ["an unknown origin kind", () => publish(request({ ...publishBody, origin: { kind: "SPACE" } })), "INVALID_REQUEST"],
    ["an origin folder that is not an ID", () => publish(request({ ...publishBody, origin: { kind: "FOLDER", folderNodeId: "x" } })), "INVALID_REQUEST"],
    ["an origin document that is not an ID", () => publish(request({ ...publishBody, origin: { kind: "DOCUMENT", documentId: "x" } })), "INVALID_REQUEST"],
    ["a join without a folder", () => join(request({}), ofPublication()), "INVALID_REQUEST"],
    ["a non-boolean acknowledgement", () => join(request({ folderNodeId, acknowledgeLowOverlap: "yes" }), ofPublication()), "INVALID_REQUEST"],
    ["a rename without a name", () => rename(request({}), ofPublication()), "INVALID_REQUEST"],
  ])("answers 400 for %s", async (_what, call, code) => {
    await expectError(await call(), 400, code);
  });

  it("does not touch a service when the request is malformed", async () => {
    await publish(request({ teamWorkspaceId: teamId, name: "A", origin: { kind: "SPACE" } }));
    expect(injected.publications.publish).not.toHaveBeenCalled();
  });

  it.each([
    ["join", () => join(request({ folderNodeId }), ofPublication("not-an-id"))],
    ["leave", () => leave(request(), ofPublication("not-an-id"))],
    ["resume", () => resume(request(), ofPublication("not-an-id"))],
    ["unpublish", () => unpublish(request(), ofPublication("not-an-id"))],
    ["restore", () => restore(request(), ofPublication("not-an-id"))],
    ["rename", () => rename(request({ name: "A" }), ofPublication("not-an-id"))],
    ["status", () => status(request(undefined, "GET"), ofPublication("not-an-id"))],
  ])("answers 400 for a malformed publication ID on %s", async (_name, call) => {
    await expectError(await call(), 400, "INVALID_REQUEST");
  });
});

describe("publication access and rollout", () => {
  it("keeps the existing sign-in answer when there is no caller", async () => {
    injected.authError = new AuthRequiredError();
    await expectError(await publish(request(publishBody)), 401, "AUTH_REQUIRED");
    expect(injected.publications.publish).not.toHaveBeenCalled();
  });

  it("answers 404 for every publication route while the flag is off", async () => {
    vi.stubEnv("KM_TEAM_WORKSPACES_ENABLED", "false");
    const calls = [
      publish(request(publishBody)),
      preview(request(publishBody)),
      join(request({ folderNodeId }), ofPublication()),
      leave(request(), ofPublication()),
      resume(request(), ofPublication()),
      unpublish(request(), ofPublication()),
      restore(request(), ofPublication()),
      rename(request({ name: "A" }), ofPublication()),
      status(request(undefined, "GET"), ofPublication()),
      list(new Request("http://hub.test/api"), ofWorkspace()),
    ];
    for (const response of await Promise.all(calls)) {
      await expectError(response, 404, "NOT_FOUND");
    }
    expect(injected.publications.publish).not.toHaveBeenCalled();
  });

  it("answers 403 for a member who may read but not publish", async () => {
    injected.publications.publish.mockRejectedValue(
      new PublicationAccessDeniedError("Publishing to a team requires source.manage."));
    await expectError(await publish(request(publishBody)), 403, "INSUFFICIENT_WORKSPACE_CAPABILITY");
  });

  it("keeps a non-member hidden as not found", async () => {
    injected.publications.list.mockRejectedValue(new WorkspaceAccessDeniedError());
    await expectError(await list(new Request("http://hub.test/api"), ofWorkspace()), 404, "NOT_FOUND");
  });

  it("names a duplicate publication name with the plan's wording", async () => {
    injected.publications.publish.mockRejectedValue(
      publicationError("PUBLICATION_NAME_TAKEN", "已有同名發佈，請取一個能說明內容的名字"));
    const response = await publish(request(publishBody));
    const body = await expectError(response, 400, "PUBLICATION_NAME_TAKEN");
    expect(body.error.message).toContain("已有同名發佈，請取一個能說明內容的名字");
  });

  it("names a restore claim conflict", async () => {
    injected.publications.restore.mockRejectedValue(
      publicationError("PUBLICATION_ORIGINAL_TAKEN", "This original is already published.", {
        originalDocumentId: folderNodeId,
      }));
    await expectError(await restore(request(), ofPublication()), 409, "PUBLICATION_ORIGINAL_TAKEN");
  });
});
