import { afterAll, beforeAll, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { MariaDbPersonalStore } from "@/infrastructure/database/mariadb/repositories/personal-items";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { KnowledgeQueryServiceImpl } from "@/modules/knowledge/application/knowledge-query-service";
import { PersonalService } from "@/modules/personal/application/personal-service";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import { uuidv7 } from "@/shared/ids/uuidv7";

let pool: Pool;

beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => pool.end());

it("resolves archived favorites through the real store and drops missing documents", async () => {
  const id = uuidv7();
  const uow = new MariaDbUnitOfWork(pool);
  const caller = callerFromIdentity({ id, emp_id: `FAV-${id}`, name: "Favorite Owner", org_code: "FAV" });
  await uow.run(repositories => repositories.users.upsertIdentity(caller.identity));
  const { workspace } = await new PersonalWorkspaceService(uow).ensurePersonalWorkspace(id);
  const sourceId = await ensureDefaultHubSource(uow, caller, workspace.id);
  const { documentId } = await new HubKnowledgeCommandServiceImpl(uow).createDocument(caller, {
    sourceId,
    parentId: null,
    title: "Favorite lifecycle",
    markdown: "body",
    metadata: {},
  });
  const personal = new PersonalService(new MariaDbPersonalStore(pool), new KnowledgeQueryServiceImpl(uow), uow);

  await personal.put(caller, workspace.id, `favorite:${documentId}`, { favorite: true }, 0);
  await expect(personal.listFavorites(caller, workspace.id)).resolves.toEqual([{ key: `favorite:${documentId}`, sourceId }]);

  await new HubKnowledgeCommandServiceImpl(uow).archiveDocument(caller, documentId);
  await expect(personal.listFavorites(caller, workspace.id)).resolves.toEqual([{ key: `favorite:${documentId}`, sourceId }]);

  await pool.query("UPDATE knowledge_sources SET status='ARCHIVED', archived_by=?, archived_at=? WHERE id=?", [caller.identity.id, new Date(), sourceId]);
  await expect(personal.listFavorites(caller, workspace.id)).resolves.toEqual([{ key: `favorite:${documentId}`, sourceId }]);

  await pool.query(
    "INSERT INTO personal_items (user_id,workspace_id,item_key,payload,version) VALUES (?,?,?,?,1)",
    [id, workspace.id, `favorite:${uuidv7()}`, JSON.stringify({ favorite: true })],
  );
  await expect(personal.listFavorites(caller, workspace.id)).resolves.toEqual([{ key: `favorite:${documentId}`, sourceId }]);

  await personal.put(caller, workspace.id, `favorite:${documentId}`, null, 1);
  await expect(personal.listFavorites(caller, workspace.id)).resolves.toEqual([]);
});
