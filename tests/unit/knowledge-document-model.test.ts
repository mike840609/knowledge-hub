import { beforeEach, describe, expect, it, vi } from "vitest";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { DocumentNotFoundError } from "@/modules/knowledge/domain/errors";
import type { applicationServices as ApplicationServicesFn } from "@/server/composition";

vi.mock("@/server/composition", () => ({ applicationServices: vi.fn() }));

import { applicationServices } from "@/server/composition";
import { getKnowledgeDocumentModel } from "@/server/knowledge-read";

type Services = ReturnType<typeof ApplicationServicesFn>;

const WORKSPACE_ID = "0199f400-0000-7000-8000-0000000005a1";
const SOURCE_ID = "0199f400-0000-7000-8000-0000000005a2";
const DOCUMENT_ID = "0199f400-0000-7000-8000-0000000005a3";
const caller = callerFromIdentity({ id: "0199f400-0000-7000-8000-0000000005a4", emp_id: "DOC-READ", name: "Reader", org_code: "HRSD" });

function revision(revisionNo: number) {
  return {
    id: `rev-${revisionNo}`,
    documentId: DOCUMENT_ID,
    revisionNo,
    title: `Title ${revisionNo}`,
    markdown: `# Body of revision ${revisionNo}`,
    metadata: {},
    contentHash: `hash-${revisionNo}`,
    createdBy: caller.identity.id,
    createdAt: new Date(Date.UTC(2026, 0, revisionNo)),
  };
}

function fakeServices(overrides: {
  getDocument?: () => Promise<unknown>;
  findEntry?: () => Promise<unknown>;
  workspaceId?: string;
} = {}) {
  const revisions = [revision(1), revision(2)];
  const findEntry = vi.fn(overrides.findEntry ?? (async () => ({ sourcePath: "notes/guide.md" })));
  const getDocument = vi.fn(overrides.getDocument ?? (async () => ({
    documentId: DOCUMENT_ID,
    sourceId: SOURCE_ID,
    workspaceId: overrides.workspaceId ?? WORKSPACE_ID,
    status: "ACTIVE",
    currentRevision: revisions[1],
  })));
  const getRevision = vi.fn(async (_caller: unknown, _id: string, revisionNo: number) => revisions[revisionNo - 1]);
  const services = {
    establishTrustedCaller: vi.fn(async () => ({ caller })),
    queries: { getDocument, listRevisions: vi.fn(async () => revisions), getRevision },
    unitOfWork: { run: vi.fn(async (work: (repositories: unknown) => unknown) => work({ entries: { findByDocumentId: findEntry } })) },
  } as unknown as Services;
  vi.mocked(applicationServices).mockReturnValue(services);
  return { findEntry, getDocument, getRevision };
}

describe("document read model", () => {
  beforeEach(() => vi.mocked(applicationServices).mockReset());

  it("returns the current revision, the history and the source path", async () => {
    fakeServices();
    const model = await getKnowledgeDocumentModel(WORKSPACE_ID, SOURCE_ID, DOCUMENT_ID);
    expect(model?.view.currentRevision.markdown).toBe("# Body of revision 2");
    expect(model?.selectedRevision.revisionNo).toBe(2);
    expect(model?.sourcePath).toBe("notes/guide.md");
    expect(model?.revisions.map((entry) => entry.revisionNo)).toEqual([1, 2]);
  });

  it("lists history without any revision's body", async () => {
    fakeServices();
    const model = await getKnowledgeDocumentModel(WORKSPACE_ID, SOURCE_ID, DOCUMENT_ID);
    expect(model?.revisions).toEqual([
      { id: "rev-1", revisionNo: 1, createdAt: new Date(Date.UTC(2026, 0, 1)) },
      { id: "rev-2", revisionNo: 2, createdAt: new Date(Date.UTC(2026, 0, 2)) },
    ]);
    expect(JSON.stringify(model?.revisions)).not.toContain("Body of revision");
  });

  it("selects a historical revision with its body", async () => {
    const { getRevision } = fakeServices();
    const model = await getKnowledgeDocumentModel(WORKSPACE_ID, SOURCE_ID, DOCUMENT_ID, { revisionNo: 1 });
    expect(model?.selectedRevision.markdown).toBe("# Body of revision 1");
    expect(getRevision).toHaveBeenCalledTimes(1);
  });

  it("reads the document once", async () => {
    const { getDocument } = fakeServices();
    await getKnowledgeDocumentModel(WORKSPACE_ID, SOURCE_ID, DOCUMENT_ID);
    expect(getDocument).toHaveBeenCalledTimes(1);
  });

  it("has no source path for a document no folder entry is linked to", async () => {
    fakeServices({ findEntry: async () => null });
    const model = await getKnowledgeDocumentModel(WORKSPACE_ID, SOURCE_ID, DOCUMENT_ID);
    expect(model?.sourcePath).toBeNull();
    expect(model?.view.documentId).toBe(DOCUMENT_ID);
  });

  it("still returns the document when the source path cannot be read", async () => {
    fakeServices({ findEntry: async () => { throw new Error("entries unavailable"); } });
    const model = await getKnowledgeDocumentModel(WORKSPACE_ID, SOURCE_ID, DOCUMENT_ID);
    expect(model?.sourcePath).toBeNull();
    expect(model?.view.documentId).toBe(DOCUMENT_ID);
  });

  it.each([
    ["another workspace", "0199f400-0000-7000-8000-0000000005ff", SOURCE_ID],
    ["another source", WORKSPACE_ID, "0199f400-0000-7000-8000-0000000005fe"],
  ])("is null, and reads nothing by id, for a document of %s", async (_label, routeWorkspaceId, routeSourceId) => {
    const { findEntry } = fakeServices();
    expect(await getKnowledgeDocumentModel(routeWorkspaceId, routeSourceId, DOCUMENT_ID)).toBeNull();
    expect(findEntry).not.toHaveBeenCalled();
  });

  it("is null, and reads nothing by id, when the caller may not read the document", async () => {
    const { findEntry } = fakeServices({ getDocument: async () => { throw new DocumentNotFoundError(); } });
    expect(await getKnowledgeDocumentModel(WORKSPACE_ID, SOURCE_ID, DOCUMENT_ID)).toBeNull();
    expect(findEntry).not.toHaveBeenCalled();
  });
});
