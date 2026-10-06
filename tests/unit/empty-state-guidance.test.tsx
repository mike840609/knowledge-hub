import { GraphExplorer } from "@/components/knowledge/graph-explorer";
import { UpdatesList } from "@/components/knowledge/updates-list";
import { FirstUseGuidance } from "@/components/knowledge/first-use-guidance";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SearchResults } from "@/components/search/search-results";
import { SearchForm } from "@/components/search/search-form";
import { WorkspaceContentActions } from "@/components/knowledge/workspace-content-actions";
import type { SearchPageModel } from "@/server/search-read";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), usePathname: () => "/w/ws/graph" }));
const auth = vi.hoisted(() => ({ confirmed: true, workspaceId: "ws", lifecycleState: "ACTIVE", canImport: true, canWrite: true }));
vi.mock("@/components/shell/use-workspace-authorization", () => ({ useWorkspaceAuthorization: () => ({ confirmed: auth.confirmed, access: { workspace: { id: auth.workspaceId, lifecycleState: auth.lifecycleState }, actions: { canImport: auth.canImport, canWrite: auth.canWrite } } }) }));
const base: SearchPageModel = { workspaceId: "ws", workspaceName: "My Space", q: "needle", scope: "workspace", sourceId: null, includeArchived: false, page: 1, sources: [], result: { terms: ["needle"], hits: [], page: 1, hasNext: false, tooLong: false }, timedOut: false };
beforeEach(() => Object.assign(auth, { confirmed: true, workspaceId: "ws", lifecycleState: "ACTIVE", canImport: true, canWrite: true }));
describe("contextual empty-state recovery", () => {
  it("offers import and note creation only for confirmed matching workspace capabilities", () => {
    expect(renderToStaticMarkup(<WorkspaceContentActions workspaceId="ws" />)).toContain("Import folder");
    auth.canImport = false;
    const readOnlyImport = renderToStaticMarkup(<WorkspaceContentActions workspaceId="ws" />);
    expect(readOnlyImport).not.toContain("Import folder"); expect(readOnlyImport).toContain("Create note");
    auth.canWrite = false;
    expect(renderToStaticMarkup(<WorkspaceContentActions workspaceId="ws" />)).toBe("");
    auth.canWrite = true; auth.confirmed = false;
    expect(renderToStaticMarkup(<WorkspaceContentActions workspaceId="ws" />)).toBe("");
    auth.confirmed = true;
    expect(renderToStaticMarkup(<WorkspaceContentActions workspaceId="foreign" />)).toBe("");
  });
  it("distinguishes a workspace without content from a query with no matches", () => {
    const empty = renderToStaticMarkup(<SearchResults model={{ ...base, hasDocuments: false }} />);
    expect(empty).toContain("No saved documents yet"); expect(empty).toContain("Import folder");
    const filtered = renderToStaticMarkup(<SearchResults model={{ ...base, hasDocuments: true, path: "docs", page: 3, scope: "all" }} />);
    expect(filtered).toContain("No results for this query."); expect(filtered).toContain("Search without filters");
    expect(filtered).toContain('/w/ws/search?q=needle&amp;scope=all'); expect(filtered).not.toContain("Import folder");
  });
  it("does not conceal failures behind a first-use message", () => {
    for (const model of [{ ...base, hasDocuments: false, timedOut: true }, { ...base, hasDocuments: false, filterError: "Invalid path" }, { ...base, hasDocuments: false, result: { ...base.result!, tooLong: true } }]) {
      const html = renderToStaticMarkup(<SearchResults model={model} />);
      expect(html).toContain('role="alert"'); expect(html).not.toContain("No saved documents yet");
    }
  });
  it("keeps the query and scope when clearing active form filters", () => {
    const html = renderToStaticMarkup(<SearchForm workspaceId="ws" q="needle" scope="all" sourceId={null} includeArchived={false} sources={[]} filters={{ path: "docs" }} />);
    expect(html).toContain('/w/ws/search?q=needle&amp;scope=all');
  });
});

it("allows note-first users to read, search and prepare context without requiring an import", () => {
  const html = renderToStaticMarkup(<FirstUseGuidance workspaceId="ws" initial={{value:{schemaVersion:1,dismissed:false},version:0}} imported={false} progress={{read:false,search:false,context:false}} firstDocumentHref="/w/ws/knowledge/notes/doc" />);
  expect(html).toContain("Get started with your documents");
  expect(html).toContain('href="/w/ws/knowledge/notes/doc"');
  expect(html).toContain('href="/w/ws/search?scope=workspace"');
  expect(html).toContain('href="/w/ws/agent-context"');
});


describe("graph access and update recovery", () => {
  const graphProps = {
    workspaceId: "ws", data: { nodes: [], edges: [], width: 1000, height: 600, unlinked: null },
    filters: { sourceId: null, orphans: true, unresolved: false, view: "graph" as const, focusId: null },
    sources: [], total: { documents: 0, edges: 0 }, truncated: null, staleDocuments: 0,
  };
  it("guides readers without offering unavailable create actions", () => {
    auth.canImport = false; auth.canWrite = false;
    const html = renderToStaticMarkup(<GraphExplorer {...graphProps} />);
    expect(html).toContain("Ask a member with edit access");
    expect(html).not.toContain('href="/w/ws/sources/import"');
    expect(html).not.toContain('href="/w/ws/knowledge/new"');
  });
  it("keeps filter recovery available to readers", () => {
    auth.canImport = false; auth.canWrite = false;
    const html = renderToStaticMarkup(<GraphExplorer {...graphProps} filters={{ ...graphProps.filters, orphans: false }} />);
    expect(html).toContain("Show all documents");
    expect(html).not.toContain("Ask a member with edit access");
  });
  it("explains archived access separately from active reader access", () => {
    auth.canImport = false; auth.canWrite = false; auth.lifecycleState = "ARCHIVED";
    const html = renderToStaticMarkup(<GraphExplorer {...graphProps} />);
    expect(html).toContain("until a workspace owner restores it");
    expect(html).not.toContain("Ask a member with edit access");
  });
  it("recovers filtered updates without retaining the unread or source filter", () => {
    const html = renderToStaticMarkup(<UpdatesList workspaceId="ws" page={{ runs: [], nextCursor: null }} filters={{ sourceId: "folder", unreadOnly: true }} />);
    expect(html).toContain("No unread folder updates");
    expect(html).toContain('href="/w/ws/updates"');
    expect(html).not.toContain("Manage folders");
  });
  it("does not claim the whole unread history is empty when older pages remain", () => {
    const html = renderToStaticMarkup(<UpdatesList workspaceId="ws" page={{ runs: [], nextCursor: { completedAt: "2026-10-06T00:00:00Z", runId: "run" } }} filters={{ unreadOnly: true }} />);
    expect(html).toContain("No unread updates on this page");
    expect(html).toContain("Older updates may contain more changes");
  });
});
