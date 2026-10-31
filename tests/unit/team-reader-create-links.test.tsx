import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const mocks = vi.hoisted(() => ({
  model: vi.fn(),
  explorer: vi.fn(),
  shell: vi.fn(),
  links: vi.fn(),
  detail: { current: undefined as { inspectorData: { createLinks?: Record<string, string> } } | undefined },
  viewer: { current: undefined as { links?: Record<string, unknown> } | undefined },
}));
vi.mock("@/server/knowledge-read", () => ({ getKnowledgeDocumentModel: mocks.model, getKnowledgeExplorerModel: mocks.explorer, getWorkspaceShellModel: mocks.shell }));
vi.mock("@/server/link-graph-read", () => ({ getDocumentLinkModel: mocks.links }));
vi.mock("@/server/document-location", () => ({ documentLocation: () => [] }));
vi.mock("@/components/knowledge/editable-document", () => ({ EditableDocument: () => null }));
vi.mock("@/components/knowledge/document-inspector", () => ({
  DocumentDetailClient: (props: { inspectorData: { createLinks?: Record<string, string> }; children?: React.ReactNode }) => {
    mocks.detail.current = props;
    return props.children;
  },
}));
vi.mock("@/components/knowledge/document-viewer", () => ({
  DocumentViewer: (props: { links?: Record<string, unknown> }) => {
    mocks.viewer.current = props;
    return null;
  },
}));
vi.mock("@/components/knowledge/owner-review-panel", () => ({ OwnerReviewPanel: ({ children }: { children?: React.ReactNode }) => children }));
vi.mock("@/components/knowledge/read-revision-marker", () => ({ ReadRevisionMarker: () => null }));
vi.mock("@/components/knowledge/revision-restore", () => ({ RevisionRestore: () => null }));
vi.mock("@/components/knowledge/backlinks-footer", () => ({ BacklinksFooter: () => null }));
import Page from "@/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/page";
import type { DocumentLinkView } from "@/modules/knowledge/application/knowledge-link-service";
import { linkLookupKey } from "@/modules/knowledge/domain/link-graph";

const key = linkLookupKey("WIKI", "Missing");
const revision = { id: "r1", title: "Title", markdown: "Text", metadata: {}, revisionNo: 1, createdAt: new Date() };
const linkView = {
  documentId: "doc",
  workspaceId: "ws",
  outgoing: [{ kind: "WIKI", target: "Missing", fragment: null, display: null, lookupKey: key, count: 1, resolution: { status: "UNRESOLVED" } }],
  unresolved: [{ kind: "WIKI", target: "Missing", fragment: null, display: null, lookupKey: key, count: 1, resolution: { status: "UNRESOLVED" } }],
  backlinks: [],
  backlinkTotal: 0,
  index: { documents: 1, stale: 0 },
  localGraph: null,
} as unknown as DocumentLinkView;

let shell: { access: { actions: { canWrite: boolean }; workspace: { lifecycleState: string } }; workspace: { type: "PERSONAL" | "TEAM" }; identityId: string };

beforeEach(() => {
  shell = { access: { actions: { canWrite: true }, workspace: { lifecycleState: "ACTIVE" } }, workspace: { type: "TEAM" }, identityId: "user" };
  mocks.model.mockImplementation(async () => ({ view: { status: "ACTIVE", currentRevision: revision }, selectedRevision: revision, revisions: [revision] }));
  mocks.explorer.mockImplementation(async () => ({ source: { ownership: "SOURCE_MANAGED", status: "ACTIVE", name: "Published" }, tree: [] }));
  mocks.shell.mockImplementation(async () => shell);
  mocks.links.mockImplementation(async () => linkView);
  mocks.detail.current = undefined;
  mocks.viewer.current = undefined;
});

const open = async () => renderToStaticMarkup(await Page({ params: Promise.resolve({ workspaceId: "ws", sourceId: "src", documentId: "doc" }) }));

it("renders a team editor's unresolved wikilink as plain text, with no way to create it", async () => {
  await open();
  expect(mocks.viewer.current?.links?.[key]).toEqual({ status: "UNRESOLVED" });
  expect(mocks.detail.current?.inspectorData.createLinks).toEqual({});
});

it("offers the same link to a My Space writer", async () => {
  shell.workspace.type = "PERSONAL";
  await open();
  expect(mocks.detail.current?.inspectorData.createLinks).toEqual({ [key]: "/w/ws/knowledge/new?title=Missing&from=doc" });
  expect(mocks.viewer.current?.links?.[key]).toEqual({ status: "UNRESOLVED", createHref: "/w/ws/knowledge/new?title=Missing&from=doc" });
});

it("offers nothing to a team member who may not write either", async () => {
  shell.access.actions.canWrite = false;
  await open();
  expect(mocks.detail.current?.inspectorData.createLinks).toEqual({});
});
