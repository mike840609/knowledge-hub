import { expect, it } from "vitest";
import { detectImageType, MAX_SVG_BYTES } from "@/shared/images/detect-image-type";
import { imageContentType } from "@/shared/markdown/image-path";

const bytes = (...parts: (number[] | string)[]) => new Uint8Array(parts.flatMap((part) => typeof part === "string" ? [...part].map((char) => char.charCodeAt(0)) : part));
const samples = {
  png: bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], "IHDR"),
  jpg: bytes([0xff, 0xd8, 0xff, 0xe0, 0, 16], "JFIF"),
  gif: bytes("GIF89a", [1, 0, 1, 0]),
  webp: bytes("RIFF", [36, 0, 0, 0], "WEBPVP8 "),
  avif: bytes([0, 0, 0, 28], "ftypavif", [0, 0, 0, 0]),
} as const;

it("knows each accepted type from its leading bytes, and every one can be served", () => {
  for (const [type, sample] of Object.entries(samples)) {
    expect(detectImageType(sample), type).toBe(type);
    expect(imageContentType(`images/x.${type}`), type).not.toBeNull();
  }
  expect(detectImageType(bytes("GIF87a"))).toBe("gif");
  expect(detectImageType(bytes([0, 0, 0, 28], "ftypavis"))).toBe("avif");
});
const text = (value: string) => new TextEncoder().encode(value);
it("knows an SVG by parsing it: well-formed XML whose root is svg", () => {
  const accepted = {
    bare: '<svg xmlns="http://www.w3.org/2000/svg"/>',
    declared: '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4"/></svg>',
    doctype: '<?xml version="1.0"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg xmlns="http://www.w3.org/2000/svg"/>',
    commented: '<!-- made by a drawing tool -->\n<!-- twice -->\n<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>',
    bom: '\uFEFF<svg xmlns="http://www.w3.org/2000/svg"/>',
    padded: '\n\n   <svg xmlns="http://www.w3.org/2000/svg"/>\n',
    // A root of svg is an SVG whatever the doctype claims; it is served as image/svg+xml with nosniff, never as HTML.
    htmlDoctype: '<!doctype html><svg xmlns="http://www.w3.org/2000/svg"></svg>',
    // Still an SVG. What it may do is decided where it is served, not here.
    scripted: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  };
  for (const [name, markup] of Object.entries(accepted)) expect(detectImageType(text(markup)), name).toBe("svg");
  expect(imageContentType("images/x.svg")).toBe("image/svg+xml");
});
it("refuses markup that is not an SVG document", () => {
  const refused = {
    html: "<!doctype html><html><body><svg></svg></body></html>",
    htmlWrapping: '<div><svg xmlns="http://www.w3.org/2000/svg"/></div>',
    otherXml: '<?xml version="1.0"?><rss version="2.0"><channel/></rss>',
    unclosed: '<svg xmlns="http://www.w3.org/2000/svg"><rect>',
    trailingJunk: '<svg xmlns="http://www.w3.org/2000/svg"/><script>alert(1)</script>',
    mentionsSvg: "this text says <svg> but is not XML",
    empty: "",
    whitespace: "   \n ",
  };
  for (const [name, markup] of Object.entries(refused)) expect(detectImageType(text(markup)), name).toBeNull();
  // Bytes that are not UTF-8 text at all.
  expect(detectImageType(new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0xff, 0xfe, 0x3e]))).toBeNull();
});
it("refuses everything else, whatever it claims to be", () => {
  const refused = {
    html: bytes("<!doctype html><script>alert(1)</script>"), pdf: bytes("%PDF-1.7"), text: bytes("just text"),
    empty: bytes(), truncatedPng: bytes([0x89], "PNG"), riffWave: bytes("RIFF", [36, 0, 0, 0], "WAVEfmt "),
    mp4: bytes([0, 0, 0, 24], "ftypisom"), heic: bytes([0, 0, 0, 24], "ftypheic"), pngLate: bytes("x", [0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a]),
  };
  for (const [name, sample] of Object.entries(refused)) expect(detectImageType(sample), name).toBeNull();
});
it("does not parse an SVG larger than its limit, and is not slowed by entities it never expands", () => {
  const open = '<svg xmlns="http://www.w3.org/2000/svg">', close = "</svg>";
  const filler = (bytes: number) => `${open}${" ".repeat(bytes - open.length - close.length)}${close}`;
  expect(detectImageType(text(filler(MAX_SVG_BYTES)))).toBe("svg");
  expect(detectImageType(text(filler(MAX_SVG_BYTES + 1)))).toBeNull();
  // "Billion laughs": ten levels of entities, each ten of the one before.
  const entities = Array.from({ length: 9 }, (_, level) => `<!ENTITY ${String.fromCharCode(98 + level)} "${`&${String.fromCharCode(97 + level)};`.repeat(10)}">`).join("");
  const laughs = `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaaaaaaaa">${entities}]>${open}<text>&j;</text>${close}`;
  const started = performance.now();
  expect(detectImageType(text(laughs))).toBe("svg");
  expect(performance.now() - started).toBeLessThan(500);
});
