import { expect, it } from "vitest";
import { extractImageSources } from "@/shared/markdown/image-sources";

it("lists inline and reference-style images once each, in the order written", () => {
  const markdown = "![a](img/a.png)\n\n![b][ref] and ![a again](img/a.png)\n\n[ref]: ../b.svg \"title\"\n";
  expect(extractImageSources(markdown)).toEqual(["img/a.png", "../b.svg"]);
});
it("ignores links, code, Obsidian embeds and an unresolved reference", () => {
  const markdown = "[link](a.png)\n\n`![x](code.png)`\n\n~~~\n![y](fenced.png)\n~~~\n\n![[embed.png]]\n\n![z][missing]\n";
  expect(extractImageSources(markdown)).toEqual([]);
});
