import { describe, expect, it, vi } from "vitest";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { applicationServices as ApplicationServicesFn } from "@/server/composition";

vi.mock("@/server/composition", () => ({ applicationServices: vi.fn() }));

import { applicationServices } from "@/server/composition";
import { PATCH } from "@/app/api/documents/[documentId]/route";

type Services = ReturnType<typeof ApplicationServicesFn>;

const caller = callerFromIdentity({ id: "0199f500-0000-7000-8000-0000000005b1", emp_id: "P5-R", name: "R", org_code: "HRSD" });
const DOCUMENT_ID = "0199f500-0000-7000-8000-0000000005b2";

type CreateRevisionFn = (caller: unknown, input: unknown) => Promise<{ revisionId: string; revisionNo: number; changed: boolean }>;

function createRevisionMock(result: { revisionId: string; revisionNo: number; changed: boolean }) {
  return vi.fn<CreateRevisionFn>(async () => result);
}

function request(body: unknown): Request {
  return new Request("http://127.0.0.1/api/documents/x", { method: "PATCH", body: JSON.stringify(body) });
}

function fakeServices(createRevision: ReturnType<typeof createRevisionMock>, metadata: Record<string, unknown> = { keep: "me" }): Services {
  return {
    establishTrustedCaller: vi.fn(async () => ({ caller })),
    queries: { getCurrentRevision: vi.fn(async () => ({ id: "rev-1", metadata })) },
    hub: { createRevision },
  } as unknown as Services;
}

const context = { params: Promise.resolve({ documentId: DOCUMENT_ID }) };

describe("PATCH /api/documents/[documentId] (spec §6.1, §6.3)", () => {
  it("passes the caller's title and markdown through to createRevision", async () => {
    const createRevision = createRevisionMock({ revisionId: "rev-2", revisionNo: 2, changed: true });
    vi.mocked(applicationServices).mockReturnValue(fakeServices(createRevision));

    const response = await PATCH(request({ title: "T", markdown: "M", expectedCurrentRevisionId: "rev-1" }), context);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revisionId: "rev-2", revisionNo: 2, changed: true });
    expect(createRevision).toHaveBeenCalledWith(caller, expect.objectContaining({
      documentId: DOCUMENT_ID, expectedCurrentRevisionId: "rev-1", title: "T", markdown: "M",
    }));
  });

  it("preserves the existing metadata instead of clearing it", async () => {
    const createRevision = createRevisionMock({ revisionId: "rev-2", revisionNo: 2, changed: true });
    vi.mocked(applicationServices).mockReturnValue(fakeServices(createRevision, { owner: "hr" }));

    await PATCH(request({ title: "T", markdown: "M", expectedCurrentRevisionId: "rev-1" }), context);

    expect(createRevision.mock.calls[0]![1]).toMatchObject({ metadata: { owner: "hr" } });
  });

  it("rejects a body missing expectedCurrentRevisionId with 400", async () => {
    vi.mocked(applicationServices).mockReturnValue(fakeServices(createRevisionMock({ revisionId: "rev-2", revisionNo: 2, changed: true })));
    const response = await PATCH(request({ title: "T", markdown: "M" }), context);
    expect(response.status).toBe(400);
  });

  it("returns 200 with changed: false verbatim on a no-op save", async () => {
    // A no-op save echoes the CURRENT revision rather than inventing a new one:
    // the content is unchanged, so no new revision was created. This is a
    // success, not an error, and must not be special-cased into a failure.
    const createRevision = createRevisionMock({ revisionId: "rev-1", revisionNo: 1, changed: false });
    vi.mocked(applicationServices).mockReturnValue(fakeServices(createRevision));

    const response = await PATCH(request({ title: "T", markdown: "M", expectedCurrentRevisionId: "rev-1" }), context);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revisionId: "rev-1", revisionNo: 1, changed: false });
  });
});
