import { beforeAll, afterAll, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { provisionIsolatedDatabase, disposeIsolatedDatabase } from "../../scripts/db/test-database";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { createSourceFixture, createDocumentForAnySource, fixtureIdentity } from "../fixtures/knowledge";
import { uuidv7 } from "@/shared/ids/uuidv7";
let handle: IsolatedDatabaseHandle, pool: Pool, uow: MariaDbUnitOfWork;
let sourceId: string, workspaceId: string, documentId: string, revisionId: string;
beforeAll(async () => {
  handle=await provisionIsolatedDatabase("test");pool=createDatabasePool({...databaseConfig("test"),database:handle.databaseName});
  await runMigrations(pool);uow=new MariaDbUnitOfWork(pool);
  const fixture=await createSourceFixture(pool);sourceId=fixture.source.id;workspaceId=fixture.workspaceId;
  ({documentId,revisionId}=await createDocumentForAnySource(pool,sourceId,fixture.folderId));
});
afterAll(async()=>{await pool?.end();if(handle) await disposeIsolatedDatabase(handle);});
it("creates reading tables once when migrations are rerun",async()=>{
  await runMigrations(pool);
  expect(await pool.query("SELECT * FROM sync_run_changes")).toEqual([]);
  expect(await pool.query("SELECT * FROM document_read_progress")).toEqual([]);
});
it("orders changes by ordinal and rejects duplicate run ordinals",async()=>{
  const runId=uuidv7();const now=new Date();
  await uow.run(async r=>{
    await r.syncRuns.insert({id:runId,sourceId,triggeredBy:fixtureIdentity.id,basedOnVersion:0,resultVersion:1,status:"APPLIED",summary:{},startedAt:now,completedAt:now});
    const base={runId,sourceId,workspaceId,kind:"DOCUMENT" as const,labels:["ADDED" as const],sourcePath:"docs/readme.md",previousPath:null,title:"Readme",documentId,beforeRevisionId:null,afterRevisionId:revisionId,beforeRevisionNo:null,afterRevisionNo:1,diagnostics:[]};
    await r.syncRunChanges.insertMany([{...base,id:uuidv7(),ordinal:2},{...base,id:uuidv7(),ordinal:1}]);
    expect((await r.syncRunChanges.listByRun(runId,0,1)).map(c=>c.ordinal)).toEqual([1]);
    expect((await r.syncRunChanges.listByRun(runId,1,10)).map(c=>c.ordinal)).toEqual([2]);
    await expect(r.syncRunChanges.insertMany([{...base,id:uuidv7(),ordinal:1}])).rejects.toThrow();
  });
});
it("paginates equal-time applied runs by id without duplicates",async()=>{
  const ids=[uuidv7(),uuidv7(),uuidv7()].sort().reverse();const now=new Date("2026-01-01T00:00:00Z");
  await uow.run(async r=>{
    for(const id of ids) await r.syncRuns.insert({id,sourceId,triggeredBy:fixtureIdentity.id,basedOnVersion:0,resultVersion:1,status:"APPLIED",summary:{},startedAt:now,completedAt:now});
    const page=await r.syncRunChanges.listAppliedRuns(workspaceId,{sourceId,limit:1,cursor:{completedAt:"2026-01-01T00:00:01.000Z",runId:uuidv7()}});
    expect(page.map(run=>run.id)).toEqual([ids[0]]);
    const next=await r.syncRunChanges.listAppliedRuns(workspaceId,{sourceId,limit:2,cursor:{completedAt:now.toISOString(),runId:ids[0]}});
    expect(next.map(run=>run.id)).toEqual(ids.slice(1));
  });
});
it("does not regress revision progress when an older tab reads later",async()=>{
  await uow.run(async r=>{
    const revision=await r.revisions.findById(revisionId);if(!revision) throw new Error("fixture revision missing");
    const newerId=uuidv7();await r.revisions.insert({...revision,id:newerId,revisionNo:3});
    const input={userId:fixtureIdentity.id,workspaceId,documentId,revisionId:newerId,revisionNo:3,readAt:new Date("2026-01-01T00:00:00Z")};
    await r.documentReadProgress.advance(input);
    await r.documentReadProgress.advance({...input,revisionId,revisionNo:1,readAt:new Date("2026-01-02T00:00:00Z")});
    expect(await r.documentReadProgress.getMany(fixtureIdentity.id,workspaceId,[documentId])).toMatchObject([{revisionId:newerId,revisionNo:3,readAt:input.readAt}]);
    expect(await r.documentReadProgress.getMany(fixtureIdentity.id,workspaceId,[])).toEqual([]);
  });
});
