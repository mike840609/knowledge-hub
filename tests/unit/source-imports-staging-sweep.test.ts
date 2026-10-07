import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Starting an import is what sweeps expired staging (src/server/import-staging-sweep.ts).
 * The composition root is replaced so the wiring is checked without a database.
 */
const createInitial = vi.fn();
const createResync = vi.fn();
const cleanup = vi.fn(async () => ({ deleted: 0 }));

vi.mock("@/server/composition", () => ({
  applicationServices: () => ({
    establishTrustedCaller: async () => ({ caller: { identity: { id: "user" } } }),
    imports: { create: { createInitial, createResync }, cleanup: { cleanup } },
  }),
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const created = { snapshotId: "snap", state: "BUILDING", expiresAt: new Date(0) };

beforeEach(() => {
  vi.resetModules();
  createInitial.mockReset().mockResolvedValue(created);
  createResync.mockReset().mockResolvedValue(created);
  cleanup.mockClear();
});

describe("starting an import sweeps expired staging", () => {
  it("sweeps after a new initial import, once per interval", async () => {
    const { createInitialSourceImport } = await import("@/server/source-imports");
    await expect(createInitialSourceImport("ws", { sourceName: "Wiki", rootName: "wiki", manifest: [] })).resolves.toBe(created);
    await createInitialSourceImport("ws", { sourceName: "Wiki", rootName: "wiki", manifest: [] });
    await flush();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("sweeps after a resync", async () => {
    const { createSourceResync } = await import("@/server/source-imports");
    await expect(createSourceResync("source", { rootName: "wiki", manifest: [] })).resolves.toBe(created);
    await flush();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("returns the created import without waiting for a sweep that never finishes", async () => {
    cleanup.mockImplementationOnce(() => new Promise(() => {}));
    const { createInitialSourceImport } = await import("@/server/source-imports");
    await expect(createInitialSourceImport("ws", { sourceName: "Wiki", rootName: "wiki", manifest: [] })).resolves.toBe(created);
  });

  it("does not sweep when the import could not be created", async () => {
    createInitial.mockRejectedValue(new Error("refused"));
    const { createInitialSourceImport } = await import("@/server/source-imports");
    await expect(createInitialSourceImport("ws", { sourceName: "Wiki", rootName: "wiki", manifest: [] })).rejects.toThrow("refused");
    await flush();
    expect(cleanup).not.toHaveBeenCalled();
  });
});
