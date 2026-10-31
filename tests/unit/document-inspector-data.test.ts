import { describe, expect, it } from "vitest";
import { documentInspectorData } from "@/server/document-inspector-data";
import type { DocumentLinkView, OutgoingLinkView } from "@/modules/knowledge/application/knowledge-link-service";
import { linkLookupKey } from "@/modules/knowledge/domain/link-graph";

const key = linkLookupKey("WIKI", "Missing");

function unresolved(kind: "WIKI" | "PATH", target: string): OutgoingLinkView {
  return { kind, target, fragment: null, display: null, lookupKey: linkLookupKey(kind, target), count: 1, resolution: { status: "UNRESOLVED" } };
}

const missing = unresolved("WIKI", "Missing");
const gone = unresolved("PATH", "gone.md");

/** A view whose local graph holds the same unresolved wikilink, as the inspector receives it. */
function view(): DocumentLinkView {
  return {
    documentId: "doc-here",
    workspaceId: "w1",
    outgoing: [missing, gone],
    unresolved: [missing, gone],
    backlinks: [],
    backlinkTotal: 0,
    index: { documents: 1, stale: 0 },
    localGraph: {
      nodes: [
        { id: "doc-here", kind: "DOCUMENT", title: "Here", sourceId: "s1", inDegree: 1, outDegree: 2 },
        { id: "unresolved:WIKI:Missing", kind: "UNRESOLVED", title: "Missing", sourceId: null, inDegree: 1, outDegree: 0 },
        { id: "unresolved:PATH:gone.md", kind: "UNRESOLVED", title: "gone.md", sourceId: null, inDegree: 1, outDegree: 0 },
      ],
      edges: [{ from: "doc-here", to: "unresolved:WIKI:Missing", count: 1 }, { from: "doc-here", to: "unresolved:PATH:gone.md", count: 1 }],
    },
  };
}

const data = (workspaceType: "PERSONAL" | "TEAM", canCreate: boolean) =>
  documentInspectorData({
    workspaceId: "w1",
    workspaceName: "Notes",
    workspaceType,
    sourceId: "s1",
    sourceName: "Notes",
    sourcePath: null,
    documentId: "doc-here",
    status: "ACTIVE",
    revisions: [{ id: "r1", revisionNo: 1, createdAt: new Date(0), history: undefined }],
    selectedRevisionNo: 1,
    includeArchived: false,
    linkView: view(),
    canCreate,
    graphDepth: 1,
    depthHrefs: { 1: "/one", 2: "/two" },
  });

const href = (type: "PERSONAL" | "TEAM", canCreate: boolean) => {
  const result = data(type, canCreate);
  const node = result.localGraph?.data.nodes.find((entry) => entry.id === "unresolved:WIKI:Missing");
  return { links: result.createLinks?.[key], node: node?.createHref };
};

describe("the inspector's create-from-link entries", () => {
  it("are there for a My Space writer, in the links list and the local graph", () => {
    expect(href("PERSONAL", true)).toEqual({
      links: "/w/w1/knowledge/new?title=Missing&from=doc-here",
      node: "/w/w1/knowledge/new?title=Missing",
    });
  });

  it("are absent in a team even for a member who may write: an unresolved link is plain text there", () => {
    expect(href("TEAM", true)).toEqual({ links: undefined, node: null });
    expect(data("TEAM", true).createLinks).toEqual({});
  });

  it("are absent for a My Space reader who may not write", () => {
    expect(href("PERSONAL", false)).toEqual({ links: undefined, node: null });
  });
});
