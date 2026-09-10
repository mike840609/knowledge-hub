import type { Pool } from "mariadb";
import { LocalIdentityProvider } from "@/infrastructure/identity/local-identity-provider";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { KnowledgeApplicationService } from "@/modules/knowledge/application/service";
import { SourceApplicationService } from "@/modules/sources/application/source-version-guard";
import { WorkspaceQueryService, WorkspaceMembershipPolicy } from "@/modules/workspaces/application/workspace-query-service";

let pool: Pool | undefined;
let services: ReturnType<typeof buildServices> | undefined;

function getPool(): Pool {
  pool ??= createDatabasePool(databaseConfig("dev"));
  return pool;
}

function buildServices(databasePool: Pool) {
  const unitOfWork = new MariaDbUnitOfWork(databasePool);
  const identityProvider = new LocalIdentityProvider();
  const knowledge = new KnowledgeApplicationService(unitOfWork);
  const sources = new SourceApplicationService(unitOfWork, knowledge);
  const workspaces = new WorkspaceQueryService(unitOfWork);
  const workspacePolicy = new WorkspaceMembershipPolicy(unitOfWork);
  return { identityProvider, unitOfWork, knowledge, sources, workspaces, workspacePolicy };
}

export function applicationServices() {
  services ??= buildServices(getPool());
  return services;
}

export async function closeApplicationPool(): Promise<void> {
  if (pool) await pool.end();
  pool = undefined;
  services = undefined;
}
