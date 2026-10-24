import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Pool } from 'mariadb';
import { createDatabasePool } from '@/infrastructure/database/mariadb/pool';
import { databaseConfig } from '@/infrastructure/database/mariadb/config';
import { buildApplicationServices } from '@/server/composition';
import { MariaDbUnitOfWork } from '@/infrastructure/database/mariadb/transaction';
import { uuidv7 } from '@/shared/ids/uuidv7';
import { createSourceFixture, createDocumentForAnySource, fixtureCaller } from '../fixtures/knowledge';
let pool:Pool; beforeAll(()=>{pool=createDatabasePool(databaseConfig('test'));});afterAll(async()=>{await pool.end();});
it('measures real database tree projection for 400 documents in four sources',async()=>{
 const first=await createSourceFixture(pool);const fixtures=[first];
 for(let i=1;i<4;i++){
  const source={...first.source,id:uuidv7(),name:`Scale source ${i}`};const folderId=uuidv7();
  await new MariaDbUnitOfWork(pool).run(async r=>{
   await r.sources.insert(source);
   await r.tree.insert({id:folderId,sourceId:source.id,parentId:null,nodeType:'FOLDER',name:'Folder',documentId:null,position:0,status:'ACTIVE',updatedBy:source.createdBy,archivedBy:null,archivedAt:null});
  });fixtures.push({source,folderId,workspaceId:first.workspaceId});
 }
 for(const f of fixtures)for(let i=0;i<100;i++)await createDocumentForAnySource(pool,f.source.id,f.folderId);
 const services=buildApplicationServices(pool),caller=fixtureCaller();
 const measure=async(all:boolean)=>{
  const start=performance.now();const sources=await services.queries.listSources(caller,first.workspaceId,{includeArchived:true});
  const collections=await Promise.all((all?sources:sources.filter(s=>s.id===first.source.id)).map(async source=>({source,tree:await services.queries.listTree(caller,source.id,{includeArchived:true})})));
  const bytes=Buffer.byteLength(JSON.stringify({sources,collections}));return {ms:performance.now()-start,bytes,treeReads:collections.length,nodes:collections.reduce((n,c)=>n+c.tree.length,0)};
 };
 await measure(true);await measure(false);
 const before=[],after=[];
 for(let i=0;i<10;i++){before.push(await measure(true));after.push(await measure(false));}
 const median=(rows:{ms:number}[])=>rows.map(r=>r.ms).sort((a,b)=>a-b)[Math.floor(rows.length/2)];
 expect(before[0].nodes).toBe(404);expect(after[0].nodes).toBe(101);expect(after[0].bytes).toBeLessThan(before[0].bytes*.3);
 console.info('REAL_DB_SOURCE_TREE_SCALE '+JSON.stringify({documents:400,sources:4,runs:10,baseline:{...before[0],p50ms:median(before)},lazy:{...after[0],p50ms:median(after)}}));
},60_000);
