import { afterEach, describe, expect, it, vi } from "vitest";
import { finalizingText, runFolderImport, type ImportUiState } from "@/components/imports/folder-import-form";
import { previewTimeLeft } from "@/components/imports/import-sticky-footer";

afterEach(() => vi.unstubAllGlobals());

function file(path: string): File {
  const f = new File(["# A\nbody"], path.split("/").at(-1)!);
  Object.defineProperty(f, "webkitRelativePath", { value: `wiki/${path}` });
  return f;
}

describe("finalize feedback", () => {
  it("says how many files are being analyzed and for how long", () => {
    expect(finalizingText(6000, 12)).toBe("Analyzing 6,000 Markdown files and building the preview… 12 s");
    expect(finalizingText(1, 0)).toBe("Analyzing 1 Markdown file and building the preview… 0 s");
    expect(finalizingText(42)).toBe("Analyzing 42 Markdown files and building the preview…");
  });

  it("reports the Markdown file count and start time when finalizing begins", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.endsWith("source-imports") ? { snapshotId: "snap" } : {})));
    const states: ImportUiState[] = [];
    const before = Date.now();
    await runFolderImport({ target: { kind: "new", workspaceId: "ws" }, files: [file("a.md"), file("b.md"), file("img/logo.png")], sourceName: "Wiki", onProgress: (state) => states.push(state) });

    const finalizing = states.find((state) => state.kind === "FINALIZING");
    expect(finalizing).toMatchObject({ kind: "FINALIZING", files: 2 });
    expect((finalizing as { startedAt: number }).startedAt).toBeGreaterThanOrEqual(before);
  });
});

describe("preview time left", () => {
  it("counts whole minutes while more than one is left", () => {
    expect(previewTimeLeft(29 * 60_000 + 59_000)).toBe("This preview expires in 29 minutes.");
    expect(previewTimeLeft(60_000)).toBe("This preview expires in 1 minute.");
  });

  it("urges applying in the last minute", () => {
    expect(previewTimeLeft(59_000)).toMatch(/^This preview expires in less than a minute\./);
    expect(previewTimeLeft(0)).toMatch(/less than a minute/);
  });
});
