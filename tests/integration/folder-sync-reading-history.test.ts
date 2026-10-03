import { beforeAll, afterAll, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { provisionIsolatedDatabase, disposeIsolatedDatabase } from "../../scripts/db/test-database";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { createSourceFixture, fixtureCaller } from "../fixtures/knowledge";
import { CreateFolderImportService } from "@/modules/sources/application/create-folder-import";
import { UploadFolderImportEntriesService } from "@/modules/sources/application/upload-folder-import-entries";
import { FinalizeFolderImportService } from "@/modules/sources/application/finalize-folder-import";
import { ApplyFolderImportService } from "@/modules/sources/application/apply-folder-import";
import { CleanupFolderImportsService } from "@/modules/sources/application/cleanup-folder-imports";
let handle: IsolatedDatabaseHandle, pool: Pool, uow: MariaDbUnitOfWork, workspaceId: string;
beforeAll(async()=>{handle=await provisionIsolatedDatabase("test");pool=createDatabasePool({...databaseConfig("test"),database:handle.databaseName});await runMigrations(pool);uow=new MariaDbUnitOfWork(pool);workspaceId=(await createSourceFixture(pool)).workspaceId;});
afterAll(async()=>{await pool?.end();if(handle)await disposeIsolatedDatabase(handle);});
async function ready(sourceId: string|null,path="docs/readme.md",owner="one",body="original"){
  const bytes=new TextEncoder().encode(`---\nknowledge_id: stable-reading-doc\nowner: ${owner}\n---\n# Readme\n\n${body}\n`);
  const args={rootName:"reading",manifest:[{uploadKey:"m1",relativePath:path,kind:"MARKDOWN" as const,size:bytes.byteLength}]};
  const create=new CreateFolderImportService(uow);
  const session=sourceId?await create.createResync(fixtureCaller(),{...args,sourceId}):await create.createInitial(fixtureCaller(),{...args,workspaceId,sourceName:"Reading"});
  await new UploadFolderImportEntriesService(uow).upload(fixtureCaller(),{snapshotId:session.snapshotId,entries:[{uploadKey:"m1",bytes}]});
  await new FinalizeFolderImportService(uow).finalize(fixtureCaller(),session.snapshotId);
  return session.snapshotId;
}
async function apply(snapshotId: string){const r=await new ApplyFolderImportService(uow).apply(fixtureCaller(),snapshotId);if(r.kind!=="APPLIED")throw new Error("unexpected conflict");return r;}
it("journals applied revisions and returns the same run for response-loss retry",async()=>{
  const snapshot=await ready(null);const first=await apply(snapshot);
  const changes=await uow.run(r=>r.syncRunChanges.listByRun(first.runId!,0,100));
  const doc=changes.find(c=>c.kind==="DOCUMENT");
  expect(doc).toMatchObject({labels:["ADDED"],beforeRevisionId:null,afterRevisionNo:1,sourcePath:"docs/readme.md"});
  expect(doc?.documentId).toBeTruthy();expect(doc?.afterRevisionId).toBeTruthy();
  expect((await apply(snapshot)).runId).toBe(first.runId);
  expect(await uow.run(r=>r.syncRunChanges.listByRun(first.runId!,0,100))).toHaveLength(changes.length);
});
it("retains document identity and immutable revisions for moves and metadata-only updates",async()=>{
  const first=await apply(await ready(null));
  const initial=(await uow.run(r=>r.syncRunChanges.listByRun(first.runId!,0,100))).find(c=>c.kind==="DOCUMENT");
  const second=await apply(await ready(first.sourceId,"security/readme.md","two"));
  const changed=(await uow.run(r=>r.syncRunChanges.listByRun(second.runId!,0,100))).find(c=>c.kind==="DOCUMENT");
  expect(changed?.labels).toContain("UPDATED");
  expect(changed).toMatchObject({documentId:initial?.documentId,beforeRevisionId:initial?.afterRevisionId,beforeRevisionNo:1,afterRevisionNo:2,previousPath:"docs/readme.md",sourcePath:"security/readme.md"});
  expect(changed?.afterRevisionId).not.toBe(initial?.afterRevisionId);
});
it("does not leave successful events after an injected Apply rollback",async()=>{
  const first=await apply(await ready(null));const snapshot=await ready(first.sourceId,"docs/readme.md","one","changed");
  const count=(await pool.query("SELECT id FROM sync_run_changes WHERE source_id=?",[first.sourceId])).length;
  await expect(new ApplyFolderImportService(uow,{failurePoint:"before-run"}).apply(fixtureCaller(),snapshot)).rejects.toThrow();
  expect(await pool.query("SELECT id FROM sync_run_changes WHERE source_id=?",[first.sourceId])).toHaveLength(count);
  const canonical=await uow.run(r=>r.importCanonicalState.load(first.sourceId));expect(canonical.documents[0].currentRevision.markdown).toContain("original");
});
it("keeps history after terminal snapshot cleanup",async()=>{
  const snapshot=await ready(null);const first=await apply(snapshot);
  await new CleanupFolderImportsService(uow).cleanup({now:new Date(Date.now()+3*86400_000)});
  expect(await uow.run(r=>r.importSnapshots.findById(snapshot))).toBeNull();
  const doc=(await uow.run(r=>r.syncRunChanges.listByRun(first.runId!,0,100))).find(c=>c.kind==="DOCUMENT");
  expect(doc?.afterRevisionId).toBeTruthy();
  expect(await uow.run(r=>r.revisions.findById(doc!.afterRevisionId!))).toMatchObject({revisionNo:1});
});
