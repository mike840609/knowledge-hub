import { describe, expect, it } from "vitest";
import { resolveInspectorTab } from "@/components/knowledge/inspector-tab-memory";

const withoutOutline = ["details", "links", "history"];
const withOutline = [...withoutOutline, "outline"];

describe("resolveInspectorTab", () => {
  it("opens on Details when nothing was asked for or remembered", () => {
    expect(resolveInspectorTab({ available: withOutline })).toBe("details");
    expect(resolveInspectorTab({ requested: null, remembered: null, available: withOutline })).toBe("details");
  });

  it("opens on the tab the reader last used", () => {
    expect(resolveInspectorTab({ remembered: "links", available: withOutline })).toBe("links");
    expect(resolveInspectorTab({ remembered: "history", available: withoutOutline })).toBe("history");
  });

  it("lets a request made just now beat what was remembered", () => {
    expect(resolveInspectorTab({ requested: "links", remembered: "history", available: withOutline })).toBe("links");
  });

  it("does not open on a tab this document does not have", () => {
    // Outline exists only when there are headings; a remembered one must not strand the next document.
    expect(resolveInspectorTab({ remembered: "outline", available: withoutOutline })).toBe("details");
    // An unavailable request falls through to what was remembered, not straight to Details.
    expect(resolveInspectorTab({ requested: "outline", remembered: "links", available: withoutOutline })).toBe("links");
  });

  it("ignores storage that holds something that is not a tab", () => {
    expect(resolveInspectorTab({ remembered: "nonsense", available: withOutline })).toBe("details");
    expect(resolveInspectorTab({ remembered: "", available: withOutline })).toBe("details");
  });
});
