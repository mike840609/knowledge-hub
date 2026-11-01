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
const auth = vi.hoisted(() => ({ confirmed: true, workspaceId: "ws", type: "PERSONAL" as "PERSONAL" | "TEAM", lifecycleState: "ACTIVE", canImport: true, canWrite: true }));
vi.mock("@/components/shell/use-workspace-authorization", () => ({ useWorkspaceAuthorization: () => ({ confirmed: auth.confirmed, access: { workspace: { id: auth.workspaceId, type: auth.type, lifecycleState: auth.lifecycleState }, actions: { canImport: auth.canImport, canWrite: auth.canWrite } } }) }));
const base: SearchPageModel = { workspaceId: "ws", workspaceName: "My Space", q: "needle", scope: "workspace", sourceId: null, includeArchived: false, page: 1, sources: [], result: { terms: ["needle"], hits: [], page: 1, hasNext: false, tooLong: false }, timedOut: false };
beforeEach(() => Object.assign(auth, { confirmed: true, workspaceId: "ws", type: "PERSONAL", lifecycleState: "ACTIVE", canImport: true, canWrite: true }));
describe("contextual empty-state recovery", () => {
  const links = (html: string) => [...html.matchAll(/<a class="([^"]*)" href="([^"]*)">.*?<\/svg>([^<]*)<\/a>/g)].map(([, cls, href, label]) => ({ label, href, primary: cls.includes("bg-kh-primary ") }));
  it("names the ways to start as the Knowledge explorer does, import first in Personal", () => {
    expect(links(renderToStaticMarkup(<WorkspaceContentActions workspaceId="ws" />))).toEqual([
      { label: "Import your first knowledge source", href: "/w/ws/sources/import", primary: true },
      { label: "Create document", href: "/w/ws/knowledge/new", primary: false },
    ]);
  });
  it("offers the ways in as buttons alone, with no line of text under each", () => {
    const html = renderToStaticMarkup(<WorkspaceContentActions workspaceId="ws" />);
    expect(html).not.toMatch(/<p[\s>]/);
    expect(html).not.toMatch(/Read-only here|edit it any time/);
  });
  it("offers no authoring actions in a Team workspace", () => {
    auth.type = "TEAM";
    // Publishing from My Space is the one way content enters a team.
    expect(renderToStaticMarkup(<WorkspaceContentActions workspaceId="ws" />)).toBe("");
  });
  it("offers only what the confirmed capabilities of this workspace allow", () => {
    auth.canImport = false;
    expect(links(renderToStaticMarkup(<WorkspaceContentActions workspaceId="ws" />))).toEqual([{ label: "Create document", href: "/w/ws/knowledge/new", primary: true }]);
    auth.canWrite = false;
    expect(renderToStaticMarkup(<WorkspaceContentActions workspaceId="ws" />)).toBe("");
    auth.canWrite = true; auth.confirmed = false;
    expect(renderToStaticMarkup(<WorkspaceContentActions workspaceId="ws" />)).toBe("");
    auth.confirmed = true;
    expect(renderToStaticMarkup(<WorkspaceContentActions workspaceId="foreign" />)).toBe("");
  });
  it("distinguishes a workspace without content from a query with no matches", () => {
    const empty = renderToStaticMarkup(<SearchResults model={{ ...base, hasDocuments: false }} />);
    expect(empty).toContain("No saved documents yet"); expect(empty).toContain("Import your first knowledge source");
    const filtered = renderToStaticMarkup(<SearchResults model={{ ...base, hasDocuments: true, path: "docs", page: 3, scope: "all" }} />);
    expect(filtered).toContain("No results for this query."); expect(filtered).toContain("Search without filters");
    expect(filtered).toContain('/w/ws/search?q=needle&amp;scope=all'); expect(filtered).not.toContain("sources/import");
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

describe("first-use guidance counts any first document", () => {
  const guide = (props: { imported?: boolean; firstDocumentHref?: string; progress?: Partial<Record<"read" | "search" | "context", boolean>> }) => renderToStaticMarkup(
    <FirstUseGuidance workspaceId="ws" initial={{ value: { schemaVersion: 1, dismissed: false }, version: 0 }} imported={props.imported ?? false} firstDocumentHref={props.firstDocumentHref}
      progress={{ read: false, search: false, context: false, ...props.progress }} />);
  it("sends a reader with nothing yet to the place that offers both ways in", () => {
    const html = guide({});
    expect(html).toContain("0 of 4 steps complete");
    // Neither way in is presented as the only one, and the first step's drawing shows both.
    expect(html).toContain("Start your knowledge workspace");
    expect(html).toContain('data-illustration="start"');
    expect(html).toContain("Import a folder, or write one here.");
    expect(html).not.toMatch(/from your folder|source of truth/);
    expect(html).toContain('<a class="kh-focus-ring rounded-md text-kh-link" href="/w/ws/knowledge">Add your first document</a>');
    expect(html).toContain("To do: </span></span><a");
  });
  it("completes the first step for a note-first reader, who never imports", () => {
    const html = guide({ firstDocumentHref: "/w/ws/knowledge/notes/doc" });
    expect(html).toContain("1 of 4 steps complete");
    expect(html).toContain("Completed: </span></span><span>Add your first document</span>");
    expect(html).toContain("Get started with your documents");
    expect(html).toContain('href="/w/ws/knowledge/notes/doc"');
    expect(html).toContain('href="/w/ws/search?scope=workspace"');
    expect(html).toContain('href="/w/ws/agent-context"');
  });
  it("completes the first step for an importer, and tells only an importer where its files change", () => {
    const html = guide({ imported: true });
    expect(html).toContain("Your local folder is the source of truth: edit files there, then import again.");
    expect(html).toContain("1 of 4 steps complete");
    expect(html).toContain("Completed: </span></span><span>Add your first document</span>");
  });
  it("lets a note-first reader finish the guide", () => {
    const html = guide({ firstDocumentHref: "/w/ws/knowledge/notes/doc", progress: { read: true, search: true, context: true } });
    expect(html).toContain("4 of 4 steps complete");
    expect(html).toContain("Your workspace is ready");
  });
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
    const html = renderToStaticMarkup(<GraphExplorer {...graphProps} total={{ documents: 3, edges: 0 }} filters={{ ...graphProps.filters, orphans: false }} />);
    expect(html).toContain("No documents match these filters");
    expect(html).toContain("About graph filters");
    expect(html).toContain("Show all documents");
    expect(html).not.toContain("Ask a member with edit access");
  });
  it("shows no filters or totals when the workspace has no document to filter", () => {
    const html = renderToStaticMarkup(<GraphExplorer {...graphProps} />);
    expect(html).toContain("Add documents to build your graph");
    for (const chrome of ["Highlight documents", "Orphans", "Unresolved", "0 documents", "About graph filters", "data-graph-find-help"]) expect(html).not.toContain(chrome);
    expect(html).toContain(">Graph</a>");
  });
  it("offers a first document, not a filter reset, when filters in the URL meet an empty workspace", () => {
    const html = renderToStaticMarkup(<GraphExplorer {...graphProps} filters={{ ...graphProps.filters, orphans: false, unresolved: true }} />);
    expect(html).toContain("Add documents to build your graph");
    expect(html).toContain('href="/w/ws/sources/import"');
    expect(html).not.toContain("No documents match these filters");
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

it("illustrates all four first-use steps with examples rather than workspace data", () => {
  const html = renderToStaticMarkup(<FirstUseGuidance workspaceId="ws" initial={{value:{schemaVersion:1,dismissed:false},version:0}} imported={false} progress={{read:false,search:false,context:false}} />);
  expect([...html.matchAll(/data-illustration="(\w+)"/g)].map(([, kind]) => kind)).toEqual(["start", "reading", "search", "context"]);
  expect(html).not.toContain("Example:");
  expect(html).toContain("0 of 4 steps complete");
  expect(html).not.toContain('href="/w/ws/agent-context"');
});

it("uses a search example only for a workspace with no content, keeping query recovery compact", () => {
  expect(renderToStaticMarkup(<SearchResults model={{ ...base, hasDocuments: false }} />)).toContain('data-illustration="search"');
  expect(renderToStaticMarkup(<SearchResults model={{ ...base, hasDocuments: true }} />)).not.toContain("data-illustration");
  expect(renderToStaticMarkup(<SearchResults model={{ ...base, hasDocuments: false, timedOut: true }} />)).not.toContain("data-illustration");
});
it("shows update examples only for the initial empty history", () => {
  const props = { workspaceId: "ws", page: { runs: [], nextCursor: null } };
  expect(renderToStaticMarkup(<UpdatesList {...props} />)).toContain('data-illustration="updates"');
  expect(renderToStaticMarkup(<UpdatesList {...props} filters={{ unreadOnly: true }} />)).not.toContain("data-illustration");
});
