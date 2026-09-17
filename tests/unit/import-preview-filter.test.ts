import { describe, expect, it } from "vitest";
import { matchesFilter } from "@/components/imports/import-preview";
import type { ImportPreviewChange } from "@/modules/sources/domain/import-plan";

function change(labels: ImportPreviewChange["labels"], diagnostics: ImportPreviewChange["diagnostics"] = []): ImportPreviewChange {
  return { kind: "DOCUMENT", sourcePath: "docs/a.md", previousPath: null, labels, diagnostics };
}

const warning = { code: "W", severity: "WARNING" as const, sourcePath: "docs/a.md", message: "w" };

describe("matchesFilter", () => {
  it("matches everything under all", () => {
    expect(matchesFilter(change(["UNCHANGED"]), "all")).toBe(true);
    expect(matchesFilter(change(["RENAMED", "UPDATED"]), "all")).toBe(true);
  });

  it("matches multi-label changes under each of their filters", () => {
    const renamedUpdated = change(["RENAMED", "UPDATED"]);
    expect(matchesFilter(renamedUpdated, "renamed")).toBe(true);
    expect(matchesFilter(renamedUpdated, "updated")).toBe(true);
    expect(matchesFilter(renamedUpdated, "moved")).toBe(false);
    expect(matchesFilter(renamedUpdated, "added")).toBe(false);
  });

  it("keeps moved and renamed independent", () => {
    expect(matchesFilter(change(["MOVED"]), "moved")).toBe(true);
    expect(matchesFilter(change(["MOVED"]), "renamed")).toBe(false);
    expect(matchesFilter(change(["RENAMED"]), "renamed")).toBe(true);
    expect(matchesFilter(change(["RENAMED"]), "moved")).toBe(false);
  });

  it("matches archived, restored, and removed under archived", () => {
    expect(matchesFilter(change(["ARCHIVED"]), "archived")).toBe(true);
    expect(matchesFilter({ ...change(["RESTORED"]), kind: "FOLDER" }, "archived")).toBe(true);
    expect(matchesFilter({ ...change(["REMOVED"]), kind: "ASSET" }, "archived")).toBe(true);
    expect(matchesFilter(change(["ADDED"]), "archived")).toBe(false);
  });

  it("matches warnings only when diagnostics exist", () => {
    expect(matchesFilter(change(["UPDATED"], [warning]), "warnings")).toBe(true);
    expect(matchesFilter(change(["UPDATED"]), "warnings")).toBe(false);
  });

  it("excludes unchanged from every specific filter", () => {
    const unchanged = change(["UNCHANGED"]);
    for (const filter of ["added", "updated", "moved", "renamed", "archived", "warnings"] as const) {
      expect(matchesFilter(unchanged, filter)).toBe(false);
    }
  });
});
