import { expect, it } from "vitest";
import { GetFolderImportPreviewService } from "@/modules/sources/application/get-folder-import-preview";
import type { SourceRepositories, SourceUnitOfWork } from "@/modules/sources/ports/unit-of-work";
import { fixtureCaller } from "../fixtures/knowledge";
const caller=fixtureCaller();
function fixture(overrides: Record<string, unknown> = {}) {
  const snapshot={id:"snapshot",createdBy:caller.identity.id,workspaceId:"ws",state:"READY",expiresAt:new Date(Date.now()+60000),plan:{planVersion:"phase2:v2",documents:{updateLocator:[{entryId:"entry",sourcePath:"note.md"}],revise:[{entryId:"entry",documentId:"doc",expectedCurrentRevisionId:"old",content:{uploadKey:"key",title:"New title",metadata:{},contentHash:"hash"}}]}},...overrides};
  const repositories={importSnapshots:{findById:async()=>snapshot},workspaceAccess:{requireWorkspaceRead:async()=>{}},importSnapshotEntries:{findByUploadKey:async()=>({sourcePath:"note.md",markdown:"new body",revisionContentHash:"hash"})},revisions:{findById:async()=>({id:"old",documentId:"doc",title:"Old title",markdown:"old body"})}};
  const uow={run:async <T>(fn:(r:SourceRepositories)=>Promise<T>)=>fn(repositories as unknown as SourceRepositories)} as SourceUnitOfWork;
  return new GetFolderImportPreviewService(uow);
}
it("compares the planned immutable revision with staged content",async()=>{
  expect(await fixture().getContentDiff(caller,"snapshot","note.md")).toEqual({sourcePath:"note.md",before:{title:"Old title",markdown:"old body"},after:{title:"New title",markdown:"new body"}});
});
it("hides another creator's snapshot",async()=>{await expect(fixture({createdBy:"other"}).getContentDiff(caller,"snapshot","note.md")).rejects.toMatchObject({code:"IMPORT_SNAPSHOT_NOT_FOUND"});});
it("rejects expired and stale previews",async()=>{
  await expect(fixture({expiresAt:new Date(0)}).getContentDiff(caller,"snapshot","note.md")).rejects.toMatchObject({code:"IMPORT_SNAPSHOT_EXPIRED"});
  await expect(fixture({state:"STALE"}).getContentDiff(caller,"snapshot","note.md")).rejects.toMatchObject({code:"IMPORT_SNAPSHOT_STALE"});
});
it("does not expose an arbitrary document path",async()=>{await expect(fixture().getContentDiff(caller,"snapshot","other.md")).rejects.toMatchObject({code:"UPLOAD_ENTRY_NOT_FOUND"});});
