import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ model: vi.fn(), explorer: vi.fn(), shell: vi.fn() }));
vi.mock("@/server/knowledge-read", () => ({ getKnowledgeDocumentModel: mocks.model, getKnowledgeExplorerModel: mocks.explorer, getWorkspaceShellModel: mocks.shell }));
vi.mock("@/server/link-graph-read", () => ({ getDocumentLinkModel: async () => null }));
vi.mock("@/server/document-location", () => ({ documentLocation: () => [] }));
vi.mock("@/server/document-inspector-data", () => ({ documentInspectorData: () => ({}) }));
vi.mock("@/components/knowledge/editable-document", () => ({ EditableDocument: () => null }));
vi.mock("@/components/knowledge/document-inspector", () => ({ DocumentDetailClient: () => null }));
vi.mock("@/components/knowledge/document-viewer", () => ({ DocumentViewer: () => null }));
vi.mock("@/components/knowledge/owner-review-panel", () => ({ OwnerReviewPanel: () => null }));
vi.mock("@/components/knowledge/read-revision-marker", () => ({ ReadRevisionMarker: () => null }));
vi.mock("@/components/knowledge/revision-restore", () => ({ RevisionRestore: () => null }));
import Page from "@/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/page";
import { EditableDocument } from "@/components/knowledge/editable-document";
import { DocumentDetailClient } from "@/components/knowledge/document-inspector";
const revision = { id: "r1", title: "Title", markdown: "Text", metadata: {}, revisionNo: 1, createdAt: new Date() };
let source: { ownership: string; status: string; name: string };
let shell: { access: { actions: { canWrite: boolean }; workspace: { lifecycleState: string } }; workspace: { type: string }; identityId: string };
let view: { status: string; currentRevision: typeof revision };
beforeEach(() => {
  source = { ownership: "HUB_MANAGED", status: "ACTIVE", name: "Notes" };
  shell = { access: { actions: { canWrite: true }, workspace: { lifecycleState: "ACTIVE" } }, workspace: { type: "PERSONAL" }, identityId: "user" };
  view = { status: "ACTIVE", currentRevision: revision };
  mocks.model.mockImplementation(async () => ({ view, selectedRevision: revision, revisions: [revision] }));
  mocks.explorer.mockImplementation(async () => ({ source, tree: [] }));
  mocks.shell.mockImplementation(async () => shell);
});
const open = (revision?: string) => Page({ params: Promise.resolve({ workspaceId: "ws", sourceId: "src", documentId: "doc" }), searchParams: Promise.resolve({ revision }) });
it("offers direct editing only on the current writable Hub document", async () => {
  expect((await open()).type).toBe(EditableDocument);
});
it.each(["source", "document", "workspace", "permission", "ownership", "revision"])("keeps %s restrictions read-only", async restriction => {
  if (restriction === "source") source.status = "ARCHIVED";
  if (restriction === "document") view.status = "ARCHIVED";
  if (restriction === "workspace") shell.access.workspace.lifecycleState = "ARCHIVED";
  if (restriction === "permission") shell.access.actions.canWrite = false;
  if (restriction === "ownership") source.ownership = "SOURCE_MANAGED";
  expect((await open(restriction === "revision" ? "1" : undefined)).type).toBe(DocumentDetailClient);
});
