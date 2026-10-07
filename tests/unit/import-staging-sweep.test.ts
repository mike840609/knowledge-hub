import { afterEach, describe, expect, it, vi } from "vitest";
import { createImportStagingSweep, IMPORT_STAGING_SWEEP_INTERVAL_MS } from "@/server/import-staging-sweep";
import { DomainError } from "@/shared/domain/errors";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => vi.restoreAllMocks());

describe("import staging sweep", () => {
  it("starts a sweep on the first import and not again within the interval", async () => {
    const sweep = createImportStagingSweep();
    const cleanup = vi.fn(async () => ({ deleted: 0 }));

    expect(sweep(cleanup, 1_000)).toBe(true);
    await flush();
    expect(sweep(cleanup, 1_000 + IMPORT_STAGING_SWEEP_INTERVAL_MS - 1)).toBe(false);
    await flush();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("sweeps again once the interval has passed", async () => {
    const sweep = createImportStagingSweep();
    const cleanup = vi.fn(async () => ({ deleted: 0 }));

    sweep(cleanup, 0);
    await flush();
    expect(sweep(cleanup, IMPORT_STAGING_SWEEP_INTERVAL_MS)).toBe(true);
    await flush();
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it("returns before the sweep finishes, and never runs two at once", async () => {
    const sweep = createImportStagingSweep(0);
    let finish: () => void = () => {};
    const cleanup = vi.fn(() => new Promise<{ deleted: number }>((resolve) => { finish = () => resolve({ deleted: 0 }); }));

    expect(sweep(cleanup, 1)).toBe(true);
    await flush();
    expect(cleanup).toHaveBeenCalledTimes(1);
    // The interval allows another, but the first is still running.
    expect(sweep(cleanup, 2)).toBe(false);
    finish();
    await flush();
    expect(sweep(cleanup, 3)).toBe(true);
  });

  it("logs how many snapshots a sweep deleted, and stays quiet when it deleted none", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const sweep = createImportStagingSweep();

    sweep(async () => ({ deleted: 0 }), 0);
    await flush();
    expect(info).not.toHaveBeenCalled();

    sweep(async () => ({ deleted: 7 }), IMPORT_STAGING_SWEEP_INTERVAL_MS);
    await flush();
    expect(info).toHaveBeenCalledWith("Import staging cleanup deleted expired snapshots", 7);
  });

  it("swallows a failed sweep, logs only its code, and can sweep again later", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sweep = createImportStagingSweep();

    expect(sweep(async () => { throw new DomainError("DB_DOWN", "connect ECONNREFUSED 10.0.0.5:3306 secret-host"); }, 0)).toBe(true);
    await flush();
    expect(warn).toHaveBeenCalledWith("Import staging cleanup failed", "DB_DOWN");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-host");

    sweep(async () => { throw new Error("raw driver text"); }, IMPORT_STAGING_SWEEP_INTERVAL_MS);
    await flush();
    expect(warn).toHaveBeenLastCalledWith("Import staging cleanup failed", "PERSISTENCE_FAILURE");
  });

  it("does not fail the caller when cleanup throws synchronously", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const sweep = createImportStagingSweep();
    expect(() => sweep(() => { throw new Error("sync failure"); }, 0)).not.toThrow();
    await flush();
  });
});
