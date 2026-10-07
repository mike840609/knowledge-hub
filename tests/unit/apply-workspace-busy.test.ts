import { expect, it } from "vitest";
import { ApplyFolderImportService } from "@/modules/sources/application/apply-folder-import";
import { SourceImportError } from "@/modules/sources/domain/import-errors";
import type { SourceUnitOfWork } from "@/modules/sources/ports/unit-of-work";
import { WorkspaceBusyError } from "@/shared/domain/errors";
import { fixtureCaller } from "../fixtures/knowledge";

/**
 * Lock timeouts are WORKSPACE_BUSY for every write, but Apply keeps its own contract
 * (import design §17.3): the preview footer keeps Apply enabled only for
 * IMPORT_APPLY_RETRYABLE, which tells the user nothing was applied.
 */
it("reports a busy workspace during Apply under its own retryable code", async () => {
  const busy = { run: async () => { throw new WorkspaceBusyError(); } } as unknown as SourceUnitOfWork;
  const rejection = new ApplyFolderImportService(busy).apply(fixtureCaller(), "snapshot");

  await expect(rejection).rejects.toBeInstanceOf(SourceImportError);
  await expect(rejection).rejects.toMatchObject({ code: "IMPORT_APPLY_RETRYABLE", message: expect.stringMatching(/Nothing was applied/) });
});

it("passes any other failure through unchanged", async () => {
  const failure = new Error("boom");
  const broken = { run: async () => { throw failure; } } as unknown as SourceUnitOfWork;
  await expect(new ApplyFolderImportService(broken).apply(fixtureCaller(), "snapshot")).rejects.toBe(failure);
});
