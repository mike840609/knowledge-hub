import { describe, expect, it } from "vitest";
import { isAllowedMarkdownImageSrc } from "@/components/knowledge/markdown-image-policy";

const ORIGIN = "https://hub.example";

describe("Markdown image URL policy (issue #20)", () => {
  it("blocks arbitrary remote https images", () => {
    expect(isAllowedMarkdownImageSrc("https://attacker.example/pixel?id=123", { origin: ORIGIN })).toBe(false);
  });

  it("blocks internal and loopback URLs", () => {
    expect(isAllowedMarkdownImageSrc("http://internal-service/health", { origin: ORIGIN })).toBe(false);
    expect(isAllowedMarkdownImageSrc("http://127.0.0.1:3000/secret.png", { origin: ORIGIN })).toBe(false);
    expect(isAllowedMarkdownImageSrc("http://localhost:3000/secret.png", { origin: ORIGIN })).toBe(false);
  });

  it("blocks protocol-relative URLs", () => {
    expect(isAllowedMarkdownImageSrc("//attacker.example/pixel.png", { origin: ORIGIN })).toBe(false);
  });

  it("blocks data: and other non-http(s) schemes", () => {
    expect(isAllowedMarkdownImageSrc("data:image/png;base64,iVBORw0KGgo=", { origin: ORIGIN })).toBe(false);
    expect(isAllowedMarkdownImageSrc("blob:https://hub.example/abc", { origin: ORIGIN })).toBe(false);
    expect(isAllowedMarkdownImageSrc("javascript:alert(1)", { origin: ORIGIN })).toBe(false);
  });

  it("blocks remote http(s) case-insensitively and with leading whitespace", () => {
    expect(isAllowedMarkdownImageSrc("HTTPS://attacker.example/x.png", { origin: ORIGIN })).toBe(false);
    expect(isAllowedMarkdownImageSrc("  https://attacker.example/x.png  ", { origin: ORIGIN })).toBe(false);
  });

  it("denies absolute http(s) URLs when no origin is available to prove same-origin", () => {
    expect(isAllowedMarkdownImageSrc("https://hub.example/assets/x.png")).toBe(false);
  });

  it("allows relative Knowledge Hub asset URLs", () => {
    expect(isAllowedMarkdownImageSrc("/assets/x.png", { origin: ORIGIN })).toBe(true);
    expect(isAllowedMarkdownImageSrc("./assets/x.png", { origin: ORIGIN })).toBe(true);
    expect(isAllowedMarkdownImageSrc("../assets/x.png", { origin: ORIGIN })).toBe(true);
    expect(isAllowedMarkdownImageSrc("assets/x.png", { origin: ORIGIN })).toBe(true);
  });

  it("allows same-origin absolute image URLs", () => {
    expect(isAllowedMarkdownImageSrc("https://hub.example/assets/x.png", { origin: ORIGIN })).toBe(true);
  });

  it("blocks cross-origin absolute URLs even when an origin is supplied", () => {
    expect(isAllowedMarkdownImageSrc("https://cdn.example/x.png", { origin: ORIGIN })).toBe(false);
  });
});
