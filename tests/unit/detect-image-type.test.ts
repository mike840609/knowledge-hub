import { expect, it } from "vitest";
import { detectImageType } from "@/shared/images/detect-image-type";
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
it("refuses everything else, whatever it claims to be", () => {
  const refused = {
    svg: bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'), xmlSvg: bytes('<?xml version="1.0"?><svg/>'),
    html: bytes("<!doctype html><script>alert(1)</script>"), pdf: bytes("%PDF-1.7"), text: bytes("just text"),
    empty: bytes(), truncatedPng: bytes([0x89], "PNG"), riffWave: bytes("RIFF", [36, 0, 0, 0], "WAVEfmt "),
    mp4: bytes([0, 0, 0, 24], "ftypisom"), heic: bytes([0, 0, 0, 24], "ftypheic"), pngLate: bytes("x", [0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a]),
  };
  for (const [name, sample] of Object.entries(refused)) expect(detectImageType(sample), name).toBeNull();
});
