import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Pool } from 'mariadb';
import { createDatabasePool } from '@/infrastructure/database/mariadb/pool';
import { databaseConfig } from '@/infrastructure/database/mariadb/config';
import { buildApplicationServices } from '@/server/composition';
import { readSidebarShortcuts } from '@/server/source-tree-read';
import { createSourceFixture, createDocumentFixture, fixtureCaller } from '../fixtures/knowledge';
let pool: Pool;
beforeAll(()=>{pool=createDatabasePool(databaseConfig('test'));});
afterAll(async()=>{await pool.end();});
it('shortcut visibility matches the tree when an active document has an archived ancestor',async()=>{
 const fixture=await createSourceFixture(pool);
 const {documentId}=await createDocumentFixture(pool,fixture.source.id,fixture.folderId);
 const services=buildApplicationServices(pool); const caller=fixtureCaller();
 const visible=()=>readSidebarShortcuts(services,caller,fixture.workspaceId,[documentId],false);
 expect(await visible()).toHaveLength(1);
 await pool.query("UPDATE knowledge_tree_nodes SET status='ARCHIVED', archived_by=?, archived_at=CURRENT_TIMESTAMP(6) WHERE id=?",[caller.identity.id,fixture.folderId]);
 expect(await visible()).toHaveLength(0);
 expect(await readSidebarShortcuts(services,caller,fixture.workspaceId,[documentId],true)).toHaveLength(1);
 // Ordinary workspace summaries preserve their existing semantics.
 expect(await services.queries.listDocumentSummaries(caller,fixture.workspaceId)).toHaveLength(1);
});
