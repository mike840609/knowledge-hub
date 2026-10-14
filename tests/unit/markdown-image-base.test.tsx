import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownImageBaseProvider, imageUrl } from "@/components/knowledge/markdown-image-base";
import { MarkdownRenderer } from "@/components/knowledge/markdown-renderer";

it("sends a relative src to the base, as written and encoded", () => {
  expect(imageUrl("/api/documents/d1/asset", "img/a b.png")).toBe("/api/documents/d1/asset?src=img%2Fa%20b.png");
  expect(imageUrl("/api/documents/d1/asset", "../x.svg?v=1")).toBe("/api/documents/d1/asset?src=..%2Fx.svg%3Fv%3D1");
  expect(imageUrl("/s/tok/asset", "/root.png")).toBe("/s/tok/asset?src=%2Froot.png");
});
it("leaves a src alone with no base, and never rewrites a URL", () => {
  expect(imageUrl(null, "img/a.png")).toBe("img/a.png");
  expect(imageUrl("/api/documents/d1/asset", "https://hub.test/x.png")).toBe("https://hub.test/x.png");
  expect(imageUrl("/api/documents/d1/asset", "//cdn.test/x.png")).toBe("//cdn.test/x.png");
});
it("the renderer draws a relative image through the base and still blocks a remote one", () => {
  const html = renderToStaticMarkup(<MarkdownImageBaseProvider base="/api/documents/d1/asset"><MarkdownRenderer markdown={"![a](img/a.png)\n\n![r](https://evil.test/p.png)"} /></MarkdownImageBaseProvider>);
  expect(html).toContain('src="/api/documents/d1/asset?src=img%2Fa.png"');
  expect(html).toContain("Image blocked: r");
  expect(html).not.toContain("evil.test");
});
it("without a provider the renderer writes the src as before", () => {
  expect(renderToStaticMarkup(<MarkdownRenderer markdown="![a](img/a.png)" />)).toContain('src="img/a.png"');
});
