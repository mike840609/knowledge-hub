import { describe, expect, it } from "vitest";
import { markdownOpensWithHeading } from "@/lib/markdown-title";

describe("markdownOpensWithHeading", () => {
  it("recognizes an opening heading whether or not it repeats the saved title", () => {
    expect(markdownOpensWithHeading("# 💰 Assets Tracker 使用說明\n\nWelcome")).toBe(true);
    expect(markdownOpensWithHeading("# Shell 操作快捷鍵指南\n\nText")).toBe(true);
  });

  it("looks past a byte-order mark and leading blank lines", () => {
    expect(markdownOpensWithHeading("﻿# Title")).toBe(true);
    expect(markdownOpensWithHeading("\n  \r\n# Title\nbody")).toBe(true);
  });

  it("does not count a heading later in the document", () => {
    expect(markdownOpensWithHeading("Intro\n\n# Assets Tracker 使用說明")).toBe(false);
  });

  it("does not count a lower-level heading, a bare hash or a hashtag", () => {
    expect(markdownOpensWithHeading("## Section\n\nText")).toBe(false);
    expect(markdownOpensWithHeading("#\n\nText")).toBe(false);
    expect(markdownOpensWithHeading("#tag at the start")).toBe(false);
  });

  it("is false for an empty document", () => {
    expect(markdownOpensWithHeading("")).toBe(false);
  });
});
