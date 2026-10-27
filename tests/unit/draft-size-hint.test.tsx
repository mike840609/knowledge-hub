import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DraftSizeHint } from "@/components/knowledge/draft-size-hint";
import { MAX_MARKDOWN_BYTES, formatBytes } from "@/lib/markdown-limits";

const render = (bytes: number) => renderToStaticMarkup(<DraftSizeHint bytes={bytes} />);

it("stays quiet well below the limit, warns near it, and names an over-limit draft", () => {
  expect(render(MAX_MARKDOWN_BYTES * 0.7)).not.toContain("of");
  expect(render(MAX_MARKDOWN_BYTES * 0.9)).toContain(`of ${formatBytes(MAX_MARKDOWN_BYTES)}`);
  expect(render(MAX_MARKDOWN_BYTES + 1)).toContain("too large");
});
