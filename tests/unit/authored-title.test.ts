import { describe, expect, it } from "vitest";
import { carryTitle, resolveAuthoredTitle, type AuthoredTitle } from "@/lib/authored-title";

function resolve(markdown: string, typedTitle = "", metadataTitle: unknown = undefined) {
  return resolveAuthoredTitle({ metadataTitle, markdown, typedTitle });
}

describe("resolveAuthoredTitle", () => {
  it("takes a frontmatter title carried in metadata over everything else", () => {
    expect(resolve("# Heading\n\nbody", "Typed", " From Frontmatter ")).toEqual({ title: "From Frontmatter", source: "METADATA" });
  });

  it("falls through a blank or non-string metadata title", () => {
    expect(resolve("# Heading", "", "   ")).toEqual({ title: "Heading", source: "H1" });
    expect(resolve("# Heading", "", 42)).toEqual({ title: "Heading", source: "H1" });
  });

  it("takes the H1 the document opens with, ignoring the typed title", () => {
    expect(resolve("# Onboarding checklist\n\n- Day 1", "Old name")).toEqual({ title: "Onboarding checklist", source: "H1" });
  });

  it("reads an H1 with inline formatting as plain text, as import does", () => {
    expect(resolve("# **季度** `OKR` 目標")).toEqual({ title: "季度 OKR 目標", source: "H1" });
  });

  it("allows a BOM and blank lines before the opening H1", () => {
    expect(resolve("﻿\n\n# After blanks")).toEqual({ title: "After blanks", source: "H1" });
  });

  it("uses the typed title, trimmed, when the H1 is not the first thing", () => {
    expect(resolve("Intro\n\n# Later heading", " Typed ")).toEqual({ title: "Typed", source: "TYPED" });
  });

  it("does not count an H2 or a setext heading as the opening H1", () => {
    expect(resolve("## Section", "Typed").source).toBe("TYPED");
    expect(resolve("Setext\n===", "Typed").source).toBe("TYPED");
  });

  it("uses the typed title when the opening H1 yields no text", () => {
    expect(resolve("# ![](diagram.png)", "Typed")).toEqual({ title: "Typed", source: "TYPED" });
  });

  it("returns an empty title when nothing supplies one", () => {
    expect(resolve("", "   ")).toEqual({ title: "", source: "TYPED" });
  });

  // F2: openingHeadingText must resolve the heading from the first line alone
  // (not a whole-document parse), so these stay correct however large the
  // body that follows is.
  it("resolves the opening H1 without needing to parse a large body", () => {
    const hugeBody = "line of body text\n".repeat(10_000); // ~180 KB
    expect(resolve(`# Big Document\n\n${hugeBody}`)).toEqual({ title: "Big Document", source: "H1" });
  });

  it("reads inline formatting in the H1 as plain text even in a large document", () => {
    const hugeBody = "line of body text\n".repeat(10_000);
    expect(resolve(`# **季度** \`OKR\` 目標\n\n${hugeBody}`)).toEqual({ title: "季度 OKR 目標", source: "H1" });
  });
});

describe("carryTitle", () => {
  const h1: AuthoredTitle = { title: "Heading", source: "H1" };
  const typed: AuthoredTitle = { title: "", source: "TYPED" };

  it("fills the title field with the H1 that was just removed", () => {
    expect(carryTitle(h1, typed, "stale saved title")).toBe("Heading");
  });

  it("leaves the typed title alone on every other transition", () => {
    expect(carryTitle(typed, typed, "mine")).toBe("mine");
    expect(carryTitle(typed, h1, "mine")).toBe("mine");
    expect(carryTitle(h1, h1, "mine")).toBe("mine");
    const metadata: AuthoredTitle = { title: "M", source: "METADATA" };
    expect(carryTitle(metadata, metadata, "mine")).toBe("mine");
  });
});
