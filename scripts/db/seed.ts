import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { localIdentityConfig } from "@/server/config";

export const DEV_FIXTURE_IDS = {
  workspace: "0199f000-0000-7000-8000-000000000001",
  source: "0199f000-0000-7000-8000-000000000101",
  folder: "0199f000-0000-7000-8000-000000000201",
};

export async function seedDevelopmentDatabase(): Promise<void> {
  const pool = createDatabasePool(databaseConfig("dev"));
  try {
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const identity = localIdentityConfig();
    await unitOfWork.run(async (repositories) => {
      await repositories.users.upsertIdentity(identity);
      const now = new Date();
      const workspace = await repositories.workspaces.findById(DEV_FIXTURE_IDS.workspace);
      if (!workspace) await repositories.workspaces.insert({ id: DEV_FIXTURE_IDS.workspace, name: "Local Knowledge", createdAt: now, updatedAt: now });
      if (!(await repositories.workspaceMemberships.find(DEV_FIXTURE_IDS.workspace, identity.id))) await repositories.workspaceMemberships.insert({ workspaceId: DEV_FIXTURE_IDS.workspace, userId: identity.id, createdAt: now });
      const existing = await repositories.sources.findById(DEV_FIXTURE_IDS.source);
      if (!existing) {
        await repositories.sources.insert({
          id: DEV_FIXTURE_IDS.source, name: "Local Hub", workspaceId: DEV_FIXTURE_IDS.workspace, sourceType: "HUB", ownership: "HUB_MANAGED", status: "ACTIVE", syncVersion: 0,
          createdBy: identity.id, updatedBy: identity.id, archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now,
        });
      }
      const folder = await repositories.tree.findById(DEV_FIXTURE_IDS.folder);
      if (!folder) await repositories.tree.insert({ id: DEV_FIXTURE_IDS.folder, sourceId: DEV_FIXTURE_IDS.source, parentId: null, nodeType: "FOLDER", name: "Getting Started", documentId: null, position: 0, status: "ACTIVE", updatedBy: identity.id, archivedBy: null, archivedAt: null });
    });
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedDevelopmentDatabase().then(() => console.log("Development fixtures are ready.")).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
