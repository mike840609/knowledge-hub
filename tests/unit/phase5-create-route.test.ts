import { describe, expect, it, vi } from "vitest";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { applicationServices as ApplicationServicesFn } from "@/server/composition";

vi.mock("@/server/composition", () => ({ applicationServices: vi.fn() }));
vi.mock("@/modules/sources/application/ensure-default-hub-source", () => ({ ensureDefaultHubSource: vi.fn() }));

import { applicationServices } from "@/server/composition";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { POST } from "@/app/api/workspaces/[workspaceId]/documents/route";

type Services = ReturnType<typeof ApplicationServicesFn>;

const WORKSPACE_ID = "0199f500-0000-7000-8000-0000000005a1";
const caller = callerFromIdentity({ id: "0199f500-0000-7000-8000-0000000005a2", emp_id: "P5-CREATE", name: "Author", org_code: "HRSD" });
const uowMarker = { marker: "unit-of-work" };

type CreateDocumentFn = (caller: unknown, input: unknown) => Promise<{ documentId: string; revisionId: string }>;
type CreateDocumentMock = ReturnType<typeof createDocumentMock>;

function createDocumentMock(result: { documentId: string; revisionId: string }) {
  return vi.fn<CreateDocumentFn>(async () => result);
}

function fakeServices(overrides: { createDocument?: CreateDocumentMock } = {}): Services {
  return {
    establishTrustedCaller: vi.fn(async () => ({ caller })),
    unitOfWork: uowMarker,
    hub: { createDocument: overrides.createDocument ?? createDocumentMock({ documentId: "doc-1", revisionId: "rev-1" }) },
  } as unknown as Services;
}

function jsonRequest(body: unknown): Request {
  return new Request(`http://localhost/api/workspaces/${WORKSPACE_ID}/documents`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const context = () => ({ params: Promise.resolve({ workspaceId: WORKSPACE_ID }) });

describe("POST /api/workspaces/:workspaceId/documents (route wiring)", () => {
  it("responds 201 with exactly documentId, sourceId, revisionId from the collaborators", async () => {
    const createDocument = createDocumentMock({ documentId: "doc-1", revisionId: "rev-1" });
    vi.mocked(applicationServices).mockReturnValue(fakeServices({ createDocument }));
    vi.mocked(ensureDefaultHubSource).mockResolvedValue("source-1");

    const response = await POST(jsonRequest({ title: "Doc", markdown: "hello" }), context());

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ documentId: "doc-1", sourceId: "source-1", revisionId: "rev-1" });
    expect(Object.keys(body).sort()).toEqual(["documentId", "revisionId", "sourceId"]);
  });

  it("passes ensureDefaultHubSource's sourceId into createDocument and echoes the same value back", async () => {
    const createDocument = createDocumentMock({ documentId: "doc-2", revisionId: "rev-2" });
    vi.mocked(applicationServices).mockReturnValue(fakeServices({ createDocument }));
    vi.mocked(ensureDefaultHubSource).mockResolvedValue("source-xyz");

    const response = await POST(jsonRequest({ title: "Doc", markdown: "hello" }), context());
    const body = await response.json();

    expect(createDocument.mock.calls[0]![1]).toMatchObject({ sourceId: "source-xyz" });
    expect(body.sourceId).toBe("source-xyz");
  });

  it("creates the document at the source root with empty metadata", async () => {
    const createDocument = createDocumentMock({ documentId: "doc-3", revisionId: "rev-3" });
    vi.mocked(applicationServices).mockReturnValue(fakeServices({ createDocument }));
    vi.mocked(ensureDefaultHubSource).mockResolvedValue("source-1");

    await POST(jsonRequest({ title: "Doc", markdown: "hello" }), context());

    expect(createDocument.mock.calls[0]![1]).toMatchObject({ parentId: null, metadata: {} });
  });

  it("passes the trusted caller from establishTrustedCaller, not anything derived from the request body", async () => {
    const createDocument = createDocumentMock({ documentId: "doc-4", revisionId: "rev-4" });
    vi.mocked(applicationServices).mockReturnValue(fakeServices({ createDocument }));
    vi.mocked(ensureDefaultHubSource).mockResolvedValue("source-1");

    // The body carries an attacker-supplied "caller" key to prove the handler ignores it.
    await POST(jsonRequest({ title: "Doc", markdown: "hello", caller: { id: "attacker" } }), context());

    expect(createDocument.mock.calls[0]![0]).toBe(caller);
    expect(ensureDefaultHubSource).toHaveBeenCalledWith(uowMarker, caller, WORKSPACE_ID);
  });

  it("returns 400 for a malformed body instead of throwing out of the handler", async () => {
    const createDocument = createDocumentMock({ documentId: "doc-5", revisionId: "rev-5" });
    vi.mocked(applicationServices).mockReturnValue(fakeServices({ createDocument }));
    vi.mocked(ensureDefaultHubSource).mockResolvedValue("source-1");

    // Neither `title` nor `filename` present: parseCreateDocumentInput's either-or check must reject this.
    const response = await POST(jsonRequest({ markdown: "hello" }), context());

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(ensureDefaultHubSource).not.toHaveBeenCalled();
    expect(createDocument).not.toHaveBeenCalled();
  });
});
