import { expect, it } from "vitest";
import { editorImageUrl, imageAlt, imageFilesOf, imageMarkdown, imageUploadFailure, insertAtCaret } from "@/lib/composer-images";

it("names an image after its file, and a nameless clipboard image plainly", () => {
  expect(imageAlt({ name: "Architecture  diagram.v2.png" })).toBe("Architecture diagram.v2");
  for (const name of ["image.png", "IMAGE.PNG", "", ".png", "   .jpg"]) expect(imageAlt({ name }), name).toBe("Pasted image");
});
it("writes ![alt](src), escaping what would end the alt", () => {
  expect(imageMarkdown("shot", "/images/a.png")).toBe("![shot](/images/a.png)");
  expect(imageMarkdown("a [b] c\\d", "/images/a.png")).toBe("![a \\[b\\] c\\\\d](/images/a.png)");
});
it("inserts at the caret as a paragraph of its own, replacing a selection", () => {
  const image = "![s](/images/a.png)";
  expect(insertAtCaret("", 0, 0, image)).toEqual({ text: image, caret: image.length });
  expect(insertAtCaret("One", 3, 3, image)).toEqual({ text: `One\n\n${image}`, caret: 5 + image.length });
  expect(insertAtCaret("One\n\nTwo", 5, 5, image).text).toBe(`One\n\n${image}\n\nTwo`);
  expect(insertAtCaret("One two", 3, 3, image).text).toBe(`One\n\n${image}\n\n two`);
  expect(insertAtCaret("One XX two", 4, 6, image).text).toBe(`One \n\n${image}\n\n two`);
  expect(insertAtCaret("One\n", 4, 4, image).text).toBe(`One\n\n${image}`);
  // Out-of-range positions are clamped rather than trusted.
  expect(insertAtCaret("One", 99, -5, image).text).toBe(`One\n\n${image}`);
});
it("sends a path to the Source's route and leaves a URL alone", () => {
  expect(editorImageUrl("s1", "/images/a b.png")).toBe("/api/sources/s1/asset?src=%2Fimages%2Fa%20b.png");
  expect(editorImageUrl("s1", "images/a.png")).toBe("/api/sources/s1/asset?src=images%2Fa.png");
  for (const src of ["https://hub.test/a.png", "//cdn.test/a.png", "data:image/png;base64,AA"]) expect(editorImageUrl("s1", src)).toBe(src);
  expect(editorImageUrl(null, "/images/a.png")).toBe("/images/a.png");
});
it("says why an image was not added", () => {
  expect(imageUploadFailure(413, "IMAGE_TOO_LARGE")).toContain("10 MiB");
  expect(imageUploadFailure(503, "IMAGE_STORAGE_UNAVAILABLE")).toContain("Your text is safe");
  expect(imageUploadFailure(404, "IMAGE_STORAGE_NOT_CONFIGURED")).toContain("does not store images");
  expect(imageUploadFailure(400, "INVALID_REQUEST")).toContain("SVG up to 2 MiB");
  expect(imageUploadFailure(403, "WORKSPACE_ACCESS_DENIED")).toContain("cannot add images");
  expect(imageUploadFailure(500, undefined)).toContain("Try again");
});
it("takes only the image files from a paste or a drop", () => {
  const files = [new File(["a"], "a.png", { type: "image/png" }), new File(["b"], "b.txt", { type: "text/plain" }), new File(["c"], "c.svg", { type: "image/svg+xml" })];
  expect(imageFilesOf({ files } as unknown as DataTransfer).map((file) => file.name)).toEqual(["a.png", "c.svg"]);
  expect(imageFilesOf(null)).toEqual([]);
});
