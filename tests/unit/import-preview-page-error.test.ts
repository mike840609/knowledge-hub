import { describe, expect, it } from "vitest";
import { importError } from "@/modules/sources/domain/import-errors";
import { classifyImportPreviewPageError } from "@/server/import-preview-page-error";

describe("Import preview page error classification", () => {
  it("keeps undiscoverable snapshots on the not-found path", () => {
    expect(
      classifyImportPreviewPageError(
        importError("IMPORT_SNAPSHOT_NOT_FOUND", "Import snapshot was not found."),
      ),
    ).toBe("NOT_FOUND");
  });

  it("renders a dedicated access-denied state for a known snapshot", () => {
    expect(
      classifyImportPreviewPageError(
        importError("IMPORT_SNAPSHOT_ACCESS_DENIED", "Import snapshot exists, but access is denied."),
      ),
    ).toBe("ACCESS_DENIED");
  });

  it("leaves unexpected errors for the route error boundary", () => {
    expect(classifyImportPreviewPageError(new Error("database unavailable"))).toBeNull();
  });
});
