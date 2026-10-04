import { expect, it } from "vitest";
import { normalizeImportScope } from "@/modules/sources/domain/import-scope";
import { hashReadyImportSnapshot } from "@/modules/sources/domain/import-integrity";
it("validates scope and normalizes rules without allowing traversal or wildcard", () => {
  expect(normalizeImportScope({ paths: ["private/", "private", "tmp\\cache"], excludedCount: 2 }, [])).toEqual({ paths: ["private", "tmp/cache"], excludedCount: 2, previousPaths: [] });
  expect(() => normalizeImportScope({ paths: ["../private"], excludedCount: 0 }, [])).toThrow();
  expect(() => normalizeImportScope({ paths: [], excludedCount: -1 }, [])).toThrow();
});
it("binds proposed scope to snapshot integrity, preserving legacy hashes without scope", () => {
  const snapshot = { adapterType: "GENERIC_MARKDOWN_FOLDER" as const, adapterVersion: "phase2:v2" as const, planVersion: "phase2:v2" as const, workspaceId: "ws", sourceId: "src", basedOnVersion: 1 };
  const legacy = hashReadyImportSnapshot(snapshot, []);
  expect(hashReadyImportSnapshot({ ...snapshot, importScope: undefined }, [])).toBe(legacy);
  expect(hashReadyImportSnapshot({ ...snapshot, importScope: { paths: ["private"], previousPaths: [], excludedCount: 1 } }, [])).not.toBe(legacy);
});
