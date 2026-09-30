import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentLinksPanel } from "@/components/knowledge/document-links-panel";
import type { DocumentLinkView, OutgoingLinkView } from "@/modules/knowledge/application/knowledge-link-service";
import { linkLookupKey } from "@/modules/knowledge/domain/link-graph";

function unresolved(kind: "WIKI" | "PATH", target: string, display: string | null = null): OutgoingLinkView {
  return { kind, target, fragment: null, display, lookupKey: linkLookupKey(kind, target), count: 1, resolution: { status: "UNRESOLVED" } };
}

function view(links: OutgoingLinkView[]): DocumentLinkView {
  return {
    documentId: "doc-here",
    workspaceId: "w1",
    outgoing: links,
    unresolved: links,
    backlinks: [],
    backlinkTotal: 0,
    index: { documents: 0, stale: 0 },
    localGraph: null,
  };
}

const render = (links: OutgoingLinkView[], createLinks?: Record<string, string>) =>
  renderToStaticMarkup(<DocumentLinksPanel view={view(links)} localGraph={null} focusId="doc-here" createLinks={createLinks} />);

describe("the Unresolved section of the Links tab", () => {
  const kube = unresolved("WIKI", "Kubernetes");
  const gone = unresolved("PATH", "../gone.md");
  const href = "/w/w1/knowledge/new?title=Kubernetes&from=doc-here";

  it("offers to create the document, on the row of the link that has an address, and only there", () => {
    const html = render([kube, gone], { [kube.lookupKey]: href });
    expect(html.match(/data-create-link/g)).toHaveLength(1);
    expect(html).toContain(`href="${href.replace("&", "&amp;")}"`);
    expect(html).toContain('aria-label="Create a document for “Kubernetes”"');
    expect(html).toContain(">Create<");
  });

  it("is the list it always was for a reader who may not write", () => {
    const html = render([kube, gone]);
    expect(html).not.toContain("data-create-link");
    expect(html).not.toContain(">Create<");
    expect(html).toContain("Kubernetes");
    expect(html).toContain("../gone.md");
  });

  it("says what the link showed, and still names its target for the way in", () => {
    const html = render([unresolved("WIKI", "Kubernetes", "the cluster docs")], { [kube.lookupKey]: href });
    expect(html).toContain("the cluster docs");
    expect(html).toContain("Create a document for “Kubernetes”");
  });
});
