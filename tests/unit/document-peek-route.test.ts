import { beforeEach, expect, it, vi } from "vitest";
import { DocumentNotFoundError } from "@/modules/knowledge/domain/errors";

const injected = vi.hoisted(() => ({
  caller: { userId: "reader" },
  getDocument: vi.fn(),
  getSource: vi.fn(),
  getDocumentLinks: vi.fn(),
  getKnowledgeExplorerModel: vi.fn(),
  getWorkspaceShellModel: vi.fn(),
}));
vi.mock("@/server/composition", () => ({
  applicationServices: () => ({
    establishTrustedCaller: async () => ({ caller: injected.caller }),
    queries: { getDocument: injected.getDocument, getSource: injected.getSource },
    links: { getDocumentLinks: injected.getDocumentLinks },
  }),
}));
vi.mock("@/server/knowledge-read", () => ({
  getKnowledgeExplorerModel: injected.getKnowledgeExplorerModel,
  getWorkspaceShellModel: injected.getWorkspaceShellModel,
}));
import { GET } from "@/app/api/documents/[documentId]/peek/route";

const request = (documentId = "d1") =>
  GET(new Request(`http://hub.test/api/documents/${documentId}/peek`), {
    params: Promise.resolve({ documentId }),
  });

beforeEach(() => {
  injected.getDocument.mockReset();
  injected.getSource.mockReset();
  injected.getDocumentLinks.mockReset();
  injected.getKnowledgeExplorerModel.mockReset();
  injected.getWorkspaceShellModel.mockReset();
  injected.getKnowledgeExplorerModel.mockResolvedValue(null);
  injected.getWorkspaceShellModel.mockResolvedValue(null);
});

const CREATED_AT = new Date("2026-10-01T12:00:00.000Z");

const hubExplorer = (overrides: Record<string, unknown> = {}) => ({
  source: {
    id: "s1",
    workspaceId: "w1",
    name: "Notes",
    sourceType: "HUB",
    status: "ACTIVE",
    ownership: "HUB_MANAGED",
    syncVersion: 1,
    ...overrides,
  },
  tree: [
    { type: "document", id: "n1", parentId: null, documentId: "d1", label: "Guide", currentRevisionId: "r1", position: 0, status: "ACTIVE" },
  ],
});

const personalWriterShell = (overrides: Record<string, unknown> = {}) => ({
  workspace: { id: "w1", name: "My Space", type: "PERSONAL", lifecycleState: "ACTIVE" },
  access: {
    actions: {
      canWrite: true,
      canSearch: true,
      canImport: false,
      canInspectSources: false,
      canOpenSettings: false,
    },
    ...(typeof overrides.access === "object" && overrides.access !== null ? (overrides.access as Record<string, unknown>) : {}),
  },
});

it("returns full markdown plus server-derived ownership and scope without caching", async () => {
  injected.getDocument.mockResolvedValue({
    documentId: "d1",
    sourceId: "s1",
    workspaceId: "w1",
    status: "ACTIVE",
    currentRevision: { title: "Guide", markdown: "# Guide\n\nBody text.", createdAt: CREATED_AT },
  });
  injected.getSource.mockResolvedValue({
    id: "s1",
    workspaceId: "w1",
    ownership: "HUB_MANAGED",
  });
  injected.getKnowledgeExplorerModel.mockResolvedValue(hubExplorer());
  injected.getWorkspaceShellModel.mockResolvedValue(personalWriterShell());
  injected.getDocumentLinks.mockResolvedValue({
    documentId: "d1",
    workspaceId: "w1",
    outgoing: [],
    unresolved: [],
    backlinks: [],
    backlinkTotal: 0,
    index: { documents: 1, stale: 0 },
    localGraph: null,
  });
  const response = await request();
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(injected.getDocument).toHaveBeenCalledWith(injected.caller, "d1");
  // Scope is derived server-side from the document, never trusted from the client.
  expect(injected.getSource).toHaveBeenCalledWith(injected.caller, "s1");
  expect(injected.getDocumentLinks).toHaveBeenCalledWith(injected.caller, "d1");
  expect(body).toEqual({
    title: "Guide",
    markdown: "# Guide\n\nBody text.",
    ownership: "HUB_MANAGED",
    workspaceId: "w1",
    sourceId: "s1",
    documentId: "d1",
    linkView: {
      documentId: "d1",
      workspaceId: "w1",
      outgoing: [],
      unresolved: [],
      backlinks: [],
      backlinkTotal: 0,
      index: { documents: 1, stale: 0 },
      localGraph: null,
    },
    breadcrumb: [{ label: "Notes", href: "/w/w1/knowledge/s1" }, { label: "Guide" }],
    updatedAt: "2026-10-01T12:00:00.000Z",
    status: "ACTIVE",
    sourceStatus: "ACTIVE",
    readOnly: false,
    editHref: "/w/w1/knowledge/s1/d1/edit",
    syncHref: null,
    canShare: true,
  });
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});

it("reports SOURCE_MANAGED ownership for synced sources", async () => {
  injected.getDocument.mockResolvedValue({
    documentId: "d2",
    sourceId: "s2",
    workspaceId: "w1",
    status: "ACTIVE",
    currentRevision: { title: "Synced", markdown: "synced body", createdAt: CREATED_AT },
  });
  injected.getSource.mockResolvedValue({ id: "s2", workspaceId: "w1", ownership: "SOURCE_MANAGED" });
  injected.getDocumentLinks.mockResolvedValue({
    documentId: "d2",
    workspaceId: "w1",
    outgoing: [],
    unresolved: [],
    backlinks: [],
    backlinkTotal: 0,
    index: { documents: 1, stale: 0 },
    localGraph: null,
  });
  const response = await request("d2");
  expect((await response.json()).ownership).toBe("SOURCE_MANAGED");
});

it("does not reveal an inaccessible or archived document", async () => {
  injected.getDocument.mockRejectedValue(new DocumentNotFoundError());
  const response = await request();
  expect(response.status).toBe(404);
  expect(injected.getSource).not.toHaveBeenCalled();
  expect(injected.getDocumentLinks).not.toHaveBeenCalled();
  expect(await response.text()).not.toContain("markdown");
});

it("returns linkView null instead of an error when links are unresolvable", async () => {
  injected.getDocument.mockResolvedValue({
    documentId: "d1",
    sourceId: "s1",
    workspaceId: "w1",
    status: "ACTIVE",
    currentRevision: { title: "Guide", markdown: "# Guide\n\nBody text.", createdAt: CREATED_AT },
  });
  injected.getSource.mockResolvedValue({ id: "s1", workspaceId: "w1", ownership: "HUB_MANAGED" });
  injected.getDocumentLinks.mockRejectedValue(new DocumentNotFoundError());
  const response = await request();
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.linkView).toBeNull();
  expect(body.title).toBe("Guide");
});

it("returns linkView null when the link view belongs to another workspace", async () => {
  injected.getDocument.mockResolvedValue({
    documentId: "d1",
    sourceId: "s1",
    workspaceId: "w1",
    status: "ACTIVE",
    currentRevision: { title: "Guide", markdown: "# Guide\n\nBody text.", createdAt: CREATED_AT },
  });
  injected.getSource.mockResolvedValue({ id: "s1", workspaceId: "w1", ownership: "HUB_MANAGED" });
  injected.getDocumentLinks.mockResolvedValue({
    documentId: "d1",
    workspaceId: "other-workspace",
    outgoing: [],
    unresolved: [],
    backlinks: [],
    backlinkTotal: 0,
    index: { documents: 1, stale: 0 },
    localGraph: null,
  });
  const response = await request();
  expect(response.status).toBe(200);
  expect((await response.json()).linkView).toBeNull();
});

it("omits editHref for a viewer without write while a PERSONAL document stays sharable", async () => {
  injected.getDocument.mockResolvedValue({
    documentId: "d1",
    sourceId: "s1",
    workspaceId: "w1",
    status: "ACTIVE",
    currentRevision: { title: "Guide", markdown: "body", createdAt: CREATED_AT },
  });
  injected.getSource.mockResolvedValue({ id: "s1", workspaceId: "w1", ownership: "HUB_MANAGED" });
  injected.getDocumentLinks.mockResolvedValue({
    documentId: "d1",
    workspaceId: "w1",
    outgoing: [],
    unresolved: [],
    backlinks: [],
    backlinkTotal: 0,
    index: { documents: 1, stale: 0 },
    localGraph: null,
  });
  injected.getKnowledgeExplorerModel.mockResolvedValue(hubExplorer());
  injected.getWorkspaceShellModel.mockResolvedValue({
    workspace: { id: "w1", name: "My Space", type: "PERSONAL", lifecycleState: "ACTIVE" },
    access: { actions: { canWrite: false, canSearch: true } },
  });
  const body = await (await request()).json();
  expect(body.editHref).toBeNull();
  expect(body.readOnly).toBe(false);
  expect(body.canShare).toBe(true);
});

it("marks SOURCE_MANAGED content read-only with a sync href only for an ACTIVE FOLDER_SYNC source", async () => {
  injected.getDocument.mockResolvedValue({
    documentId: "d2",
    sourceId: "s2",
    workspaceId: "w1",
    status: "ACTIVE",
    currentRevision: { title: "Synced", markdown: "synced body", createdAt: CREATED_AT },
  });
  injected.getSource.mockResolvedValue({ id: "s2", workspaceId: "w1", ownership: "SOURCE_MANAGED" });
  injected.getDocumentLinks.mockResolvedValue({
    documentId: "d2",
    workspaceId: "w1",
    outgoing: [],
    unresolved: [],
    backlinks: [],
    backlinkTotal: 0,
    index: { documents: 1, stale: 0 },
    localGraph: null,
  });
  injected.getKnowledgeExplorerModel.mockResolvedValue({
    source: {
      id: "s2",
      workspaceId: "w1",
      name: "Synced folder",
      sourceType: "FOLDER_SYNC",
      status: "ACTIVE",
      ownership: "SOURCE_MANAGED",
      syncVersion: 3,
    },
    tree: [
      { type: "document", id: "n2", parentId: null, documentId: "d2", label: "Synced", currentRevisionId: "r2", position: 0, status: "ACTIVE" },
    ],
  });
  injected.getWorkspaceShellModel.mockResolvedValue(personalWriterShell());
  const body = await (await request("d2")).json();
  expect(body.readOnly).toBe(true);
  expect(body.editHref).toBeNull();
  expect(body.syncHref).toBe("/w/w1/sources/s2/update");
  // Sharing is reading (share-link spec 10.1): ownership is not consulted.
  expect(body.canShare).toBe(true);
});

it("omits syncHref when the source is not an ACTIVE FOLDER_SYNC source", async () => {
  injected.getDocument.mockResolvedValue({
    documentId: "d1",
    sourceId: "s1",
    workspaceId: "w1",
    status: "ACTIVE",
    currentRevision: { title: "Guide", markdown: "body", createdAt: CREATED_AT },
  });
  injected.getSource.mockResolvedValue({ id: "s1", workspaceId: "w1", ownership: "HUB_MANAGED" });
  injected.getDocumentLinks.mockResolvedValue({
    documentId: "d1",
    workspaceId: "w1",
    outgoing: [],
    unresolved: [],
    backlinks: [],
    backlinkTotal: 0,
    index: { documents: 1, stale: 0 },
    localGraph: null,
  });
  injected.getKnowledgeExplorerModel.mockResolvedValue(hubExplorer({ sourceType: "FILE_UPLOAD" }));
  injected.getWorkspaceShellModel.mockResolvedValue(personalWriterShell());
  expect((await (await request()).json()).syncHref).toBeNull();
});

it("reflects an archived document with no edit href and no share", async () => {
  injected.getDocument.mockResolvedValue({
    documentId: "d9",
    sourceId: "s1",
    workspaceId: "w1",
    status: "ARCHIVED",
    currentRevision: { title: "Old", markdown: "old body", createdAt: CREATED_AT },
  });
  injected.getSource.mockResolvedValue({ id: "s1", workspaceId: "w1", ownership: "HUB_MANAGED" });
  injected.getDocumentLinks.mockResolvedValue({
    documentId: "d9",
    workspaceId: "w1",
    outgoing: [],
    unresolved: [],
    backlinks: [],
    backlinkTotal: 0,
    index: { documents: 1, stale: 0 },
    localGraph: null,
  });
  injected.getKnowledgeExplorerModel.mockResolvedValue(hubExplorer());
  injected.getWorkspaceShellModel.mockResolvedValue(personalWriterShell());
  const body = await (await request("d9")).json();
  expect(body.status).toBe("ARCHIVED");
  expect(body.editHref).toBeNull();
  expect(body.canShare).toBe(false);
});

it("reflects an archived source with no sync href and no share", async () => {
  injected.getDocument.mockResolvedValue({
    documentId: "d2",
    sourceId: "s2",
    workspaceId: "w1",
    status: "ACTIVE",
    currentRevision: { title: "Synced", markdown: "synced body", createdAt: CREATED_AT },
  });
  injected.getSource.mockResolvedValue({ id: "s2", workspaceId: "w1", ownership: "SOURCE_MANAGED" });
  injected.getDocumentLinks.mockResolvedValue({
    documentId: "d2",
    workspaceId: "w1",
    outgoing: [],
    unresolved: [],
    backlinks: [],
    backlinkTotal: 0,
    index: { documents: 1, stale: 0 },
    localGraph: null,
  });
  injected.getKnowledgeExplorerModel.mockResolvedValue({
    source: {
      id: "s2",
      workspaceId: "w1",
      name: "Synced folder",
      sourceType: "FOLDER_SYNC",
      status: "ARCHIVED",
      ownership: "SOURCE_MANAGED",
      syncVersion: 3,
    },
    tree: [],
  });
  injected.getWorkspaceShellModel.mockResolvedValue(personalWriterShell());
  const body = await (await request("d2")).json();
  expect(body.sourceStatus).toBe("ARCHIVED");
  expect(body.syncHref).toBeNull();
  expect(body.canShare).toBe(false);
});

it("builds the breadcrumb through folders to the document title", async () => {
  injected.getDocument.mockResolvedValue({
    documentId: "d3",
    sourceId: "s1",
    workspaceId: "w1",
    status: "ACTIVE",
    currentRevision: { title: "Deep note", markdown: "body", createdAt: CREATED_AT },
  });
  injected.getSource.mockResolvedValue({ id: "s1", workspaceId: "w1", ownership: "HUB_MANAGED" });
  injected.getDocumentLinks.mockResolvedValue({
    documentId: "d3",
    workspaceId: "w1",
    outgoing: [],
    unresolved: [],
    backlinks: [],
    backlinkTotal: 0,
    index: { documents: 1, stale: 0 },
    localGraph: null,
  });
  injected.getKnowledgeExplorerModel.mockResolvedValue({
    source: {
      id: "s1",
      workspaceId: "w1",
      name: "Notes",
      sourceType: "HUB",
      status: "ACTIVE",
      ownership: "HUB_MANAGED",
      syncVersion: 1,
    },
    tree: [
      { type: "folder", id: "f1", parentId: null, label: "Projects", position: 0, status: "ACTIVE" },
      { type: "folder", id: "f2", parentId: "f1", label: "Hub", position: 0, status: "ACTIVE" },
      { type: "document", id: "n3", parentId: "f2", documentId: "d3", label: "Deep note", currentRevisionId: "r3", position: 0, status: "ACTIVE" },
    ],
  });
  injected.getWorkspaceShellModel.mockResolvedValue(personalWriterShell());
  const body = await (await request("d3")).json();
  expect(body.breadcrumb).toEqual([
    { label: "Notes", href: "/w/w1/knowledge/s1" },
    { label: "Projects" },
    { label: "Hub" },
    { label: "Deep note" },
  ]);
  expect(body.updatedAt).toBe("2026-10-01T12:00:00.000Z");
});

it("refuses share in a TEAM workspace even when the document is editable", async () => {
  injected.getDocument.mockResolvedValue({
    documentId: "d1",
    sourceId: "s1",
    workspaceId: "w1",
    status: "ACTIVE",
    currentRevision: { title: "Guide", markdown: "body", createdAt: CREATED_AT },
  });
  injected.getSource.mockResolvedValue({ id: "s1", workspaceId: "w1", ownership: "HUB_MANAGED" });
  injected.getDocumentLinks.mockResolvedValue({
    documentId: "d1",
    workspaceId: "w1",
    outgoing: [],
    unresolved: [],
    backlinks: [],
    backlinkTotal: 0,
    index: { documents: 1, stale: 0 },
    localGraph: null,
  });
  injected.getKnowledgeExplorerModel.mockResolvedValue(hubExplorer());
  injected.getWorkspaceShellModel.mockResolvedValue({
    workspace: { id: "w1", name: "Team", type: "TEAM", lifecycleState: "ACTIVE" },
    access: { actions: { canWrite: true, canSearch: true } },
  });
  const body = await (await request()).json();
  expect(body.editHref).toBe("/w/w1/knowledge/s1/d1/edit");
  expect(body.canShare).toBe(false);
});

it("falls back to closed header facts when explorer and shell are unavailable", async () => {
  injected.getDocument.mockResolvedValue({
    documentId: "d1",
    sourceId: "s1",
    workspaceId: "w1",
    status: "ACTIVE",
    currentRevision: { title: "Guide", markdown: "body", createdAt: CREATED_AT },
  });
  injected.getSource.mockResolvedValue({ id: "s1", workspaceId: "w1", ownership: "HUB_MANAGED" });
  injected.getDocumentLinks.mockResolvedValue({
    documentId: "d1",
    workspaceId: "w1",
    outgoing: [],
    unresolved: [],
    backlinks: [],
    backlinkTotal: 0,
    index: { documents: 1, stale: 0 },
    localGraph: null,
  });
  const body = await (await request()).json();
  expect(body.breadcrumb).toEqual([{ label: "Guide" }]);
  expect(body.sourceStatus).toBe("ARCHIVED");
  expect(body.readOnly).toBe(true);
  expect(body.editHref).toBeNull();
  expect(body.syncHref).toBeNull();
  expect(body.canShare).toBe(false);
  expect(body.status).toBe("ACTIVE");
});
