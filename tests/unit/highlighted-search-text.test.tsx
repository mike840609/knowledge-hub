import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HighlightedSearchText } from "@/components/search/highlighted-search-text";
import { parseSearchQuery } from "@/modules/knowledge/domain/search-query";

it("marks Chinese and case-insensitive English keywords while preserving text", () => {
  const html = renderToStaticMarkup(<HighlightedSearchText text="請假 Leave Policy" terms={parseSearchQuery("請假 leave").terms} />);
  expect(html).toMatch(/<mark[^>]*>請假<\/mark>/);
  expect(html).toMatch(/<mark[^>]*>Leave<\/mark>/);
  expect(html).toContain("Policy");
});
it("renders literal query characters safely and leaves empty queries unmarked", () => {
  const html = renderToStaticMarkup(<HighlightedSearchText text="<script> a+b" terms={["<script>", "a+b"]} />);
  expect(html).toContain("&lt;script&gt;</mark>");
  expect(html).toContain("a+b</mark>");
  expect(renderToStaticMarkup(<HighlightedSearchText text="Recent document" terms={[]} />)).not.toContain("<mark");
});
