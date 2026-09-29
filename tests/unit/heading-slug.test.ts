import { describe, expect, it } from "vitest";
import { HeadingSlugger, headingSlug } from "@/shared/markdown/heading-slug";

describe("headingSlug", () => {
  it("matches GitHub for ordinary English headings", () => {
    expect(headingSlug("Local Setup")).toBe("local-setup");
    expect(headingSlug("What's new in v2.0?")).toBe("whats-new-in-v20");
    expect(headingSlug("snake_case stays")).toBe("snake_case-stays");
  });

  it("keeps runs of hyphens and edge hyphens, as GitHub does", () => {
    expect(headingSlug("a - b")).toBe("a---b");
    expect(headingSlug("-lead")).toBe("-lead");
    expect(headingSlug("a  b")).toBe("a--b");
  });

  it("keeps non-Latin headings addressable", () => {
    expect(headingSlug("請假流程")).toBe("請假流程");
    expect(headingSlug("請假流程 Leave Policy")).toBe("請假流程-leave-policy");
    expect(headingSlug("Café menu")).toBe("café-menu");
  });

  it("composes decomposed accents so the id is stable", () => {
    expect(headingSlug("Café")).toBe(headingSlug("Café"));
  });

  it("never produces an empty id", () => {
    expect(headingSlug("")).toBe("section");
    expect(headingSlug("???")).toBe("section");
    expect(headingSlug("🎉")).toBe("section");
  });
});

describe("HeadingSlugger", () => {
  it("numbers repeats in reading order", () => {
    const slugger = new HeadingSlugger();
    expect([slugger.slug("Setup"), slugger.slug("Setup"), slugger.slug("Setup")]).toEqual(["setup", "setup-1", "setup-2"]);
  });

  it("treats a suffixed slug as taken", () => {
    const slugger = new HeadingSlugger();
    expect([slugger.slug("Setup"), slugger.slug("Setup"), slugger.slug("Setup 1"), slugger.slug("Setup")]).toEqual([
      "setup",
      "setup-1",
      "setup-1-1",
      "setup-2",
    ]);
  });

  it("does not share state between documents", () => {
    expect(new HeadingSlugger().slug("Intro")).toBe("intro");
    expect(new HeadingSlugger().slug("Intro")).toBe("intro");
  });
});
