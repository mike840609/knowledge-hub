import { afterEach, describe, expect, it, vi } from "vitest";
import { importRuntimeConfig } from "@/server/import-config";

afterEach(() => vi.unstubAllEnvs());

describe("import asset runtime limits", () => {
  it("defaults to 64 MiB per asset and 512 MiB combined", () => {
    vi.stubEnv("KM_IMPORT_MAX_ASSET_FILE_BYTES", "");
    vi.stubEnv("KM_IMPORT_MAX_ASSET_TOTAL_BYTES", "");
    expect(importRuntimeConfig().limits).toMatchObject({ maxAssetFileBytes: 64 * 1024 * 1024, maxAssetTotalBytes: 512 * 1024 * 1024 });
  });
  it("uses the configured byte limits", () => {
    vi.stubEnv("KM_IMPORT_MAX_ASSET_FILE_BYTES", "123");
    vi.stubEnv("KM_IMPORT_MAX_ASSET_TOTAL_BYTES", "456");
    expect(importRuntimeConfig().limits).toMatchObject({ maxAssetFileBytes: 123, maxAssetTotalBytes: 456 });
  });
  it.each(["0", "-1", "1.5", "NaN", "9007199254740992"])("rejects invalid asset limits: %s", (value) => {
    for (const name of ["KM_IMPORT_MAX_ASSET_FILE_BYTES", "KM_IMPORT_MAX_ASSET_TOTAL_BYTES"]) {
      vi.stubEnv(name, value);
      expect(() => importRuntimeConfig()).toThrow(`${name} must be a positive integer.`);
      vi.stubEnv(name, "");
    }
  });
});
