import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SearchResultRow } from "@/components/search/search-result-row";
import type { KnowledgeSearchRow } from "@/modules/knowledge/ports/knowledge-search-repository";

function hit(pageIcon: string | null): KnowledgeSearchRow {
  return {
    documentId: "doc",
    sourceId: "src",
    workspaceId: "ws",
    title: "A document",
    sourceName: "Notes",
    workspaceName: "My Space",
    snippet: "Some words.",
    status: "ACTIVE",
    updatedAt: new Date("2026-10-24T09:00:00Z"),
    pageIcon,
  };
}

const render = (row: KnowledgeSearchRow) => renderToStaticMarkup(
  <SearchResultRow hit={row} terms={[]} includeArchived={false} showWorkspace={false} />,
);

it("shows the document's page icon when it has one", () => {
  const html = render(hit("📌"));
  expect(html).toContain("📌");
});

it("keeps the file glyph when the document has no page icon", () => {
  expect(render(hit(null))).toContain("<svg");
});
