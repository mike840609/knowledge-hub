import type { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { CreateFolderImportService } from "@/modules/sources/application/create-folder-import";
import { UploadFolderImportEntriesService } from "@/modules/sources/application/upload-folder-import-entries";
import { FinalizeFolderImportService } from "@/modules/sources/application/finalize-folder-import";
import { fixtureCaller } from "./knowledge";
export async function prepareReadingImport(
  uow: MariaDbUnitOfWork,
  workspaceId: string,
  sourceId: string | null,
  files: { path: string; text: string }[],
) {
  const entries = files.map((f, i) => ({
    key: `m${i}`,
    path: f.path,
    bytes: new TextEncoder().encode(f.text),
  }));
  const input = {
    rootName: "reading",
    manifest: entries.map((e) => ({
      uploadKey: e.key,
      relativePath: e.path,
      kind: "MARKDOWN" as const,
      size: e.bytes.byteLength,
    })),
  };
  const create = new CreateFolderImportService(uow);
  const session = sourceId
    ? await create.createResync(fixtureCaller(), { ...input, sourceId })
    : await create.createInitial(fixtureCaller(), {
        ...input,
        workspaceId,
        sourceName: "Reading",
      });
  for (let i = 0; i < entries.length; i += 20)
    await new UploadFolderImportEntriesService(uow).upload(fixtureCaller(), {
      snapshotId: session.snapshotId,
      entries: entries
        .slice(i, i + 20)
        .map((e) => ({ uploadKey: e.key, bytes: e.bytes })),
    });
  await new FinalizeFolderImportService(uow).finalize(
    fixtureCaller(),
    session.snapshotId,
  );
  return session.snapshotId;
}
