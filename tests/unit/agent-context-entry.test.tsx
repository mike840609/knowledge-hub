import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentLinksPanel } from "@/components/knowledge/document-links-panel";
import { documentInspectorData, graphFocusContextHref, neighbourhoodContextHref } from "@/server/document-inspector-data";
import type { DocumentLinkView } from "@/modules/knowledge/application/knowledge-link-service";
import type { GraphNode } from "@/modules/knowledge/domain/link-graph";

// The local graph's canvas navigates on click; it is never clicked here.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

const node = (id: string, kind: GraphNode["kind"] = "DOCUMENT"): GraphNode => ({ id, kind, title: id, sourceId: kind === "DOCUMENT" ? "s" : null, inDegree: 1, outDegree: 1 });
const href = (nodes: GraphNode[] | null, eligible = true, depth: 1 | 2 = 2) => neighbourhoodContextHref({ workspaceId: "ws", documentId: "self", depth, eligible, nodes });

describe("neighbourhoodContextHref", () => {
  it("offers the neighbourhood when another document is linked", () => {
    expect(href([node("self"), node("other")])).toBe("/w/ws/agent-context?around=self&depth=2");
  });
  it("hides it when the only links are broken", () => {
    expect(href([node("self"), node("unresolved:x", "UNRESOLVED")])).toBeNull();
  });
  it("hides it when not eligible or without a graph", () => {
    expect(href([node("self"), node("other")], false)).toBeNull();
    expect(href(null)).toBeNull();
  });
});

const linkView: DocumentLinkView = {
  documentId: "self", workspaceId: "ws", outgoing: [], unresolved: [], backlinks: [], backlinkTotal: 0, index: { documents: 2, stale: 0 },
  localGraph: { nodes: [node("self"), node("other")], edges: [{ from: "self", to: "other", count: 1 }] },
} as unknown as DocumentLinkView;
const inspector = (depthHrefs: { 1: string; 2: string } | null, agentContext = true) => documentInspectorData({
  workspaceId: "ws", workspaceName: "My Space", sourceId: "s", sourceName: "Notes", sourcePath: null, documentId: "self", status: "ACTIVE",
  revisions: [], selectedRevisionNo: 1, includeArchived: false, linkView, canCreate: false, graphDepth: 1, depthHrefs, agentContext,
});

describe("the Links tab entry", () => {
  it("is offered beside Open in graph with the depth shown", () => {
    const data = inspector({ 1: "/d", 2: "/d?graph=2" });
    expect(data.localGraph?.agentContextHref).toBe("/w/ws/agent-context?around=self&depth=1");
    const html = renderToStaticMarkup(<DocumentLinksPanel view={linkView} localGraph={data.localGraph} focusId="self" />);
    expect(html).toContain('href="/w/ws/agent-context?around=self&amp;depth=1"');
    expect(html).toContain('aria-label="Copy for Agent with nearby documents"');
    expect(html).toContain(">Copy for Agent<");
    expect(html).toContain(">Open in graph<");
  });
  it("is absent from the composer and when Copy for Agent is unavailable", () => {
    expect(inspector(null).localGraph?.agentContextHref).toBeNull();
    const data = inspector({ 1: "/d", 2: "/d?graph=2" }, false);
    expect(data.localGraph?.agentContextHref).toBeNull();
    expect(renderToStaticMarkup(<DocumentLinksPanel view={linkView} localGraph={data.localGraph} focusId="self" />)).not.toContain("Copy for Agent");
  });
});

describe("the graph page entry", () => {
  const nodes = [node("doc"), node("unresolved:WIKI:a&b", "UNRESOLVED")];
  it("is offered for a focused document, at depth 1", () => {
    expect(graphFocusContextHref({ workspaceId: "ws", focusId: "doc", eligible: true, nodes })).toBe("/w/ws/agent-context?around=doc&depth=1");
  });
  it("is not offered for a focused broken link, without a focus, or when unavailable", () => {
    expect(graphFocusContextHref({ workspaceId: "ws", focusId: "unresolved:WIKI:a&b", eligible: true, nodes })).toBeNull();
    expect(graphFocusContextHref({ workspaceId: "ws", focusId: null, eligible: true, nodes })).toBeNull();
    expect(graphFocusContextHref({ workspaceId: "ws", focusId: "doc", eligible: false, nodes })).toBeNull();
  });
});
