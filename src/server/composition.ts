import type { Pool } from "mariadb";
import { LocalIdentityProvider } from "@/infrastructure/identity/local-identity-provider";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { KnowledgeQueryServiceImpl } from "@/modules/knowledge/application/knowledge-query-service";
import { SourceApplicationService } from "@/modules/sources/application/source-version-guard";
import { WorkspaceQueryService } from "@/modules/workspaces/application/workspace-query-service";

let pool: Pool | undefined;
let services: ReturnType<typeof buildServices> | undefined;

function getPool(): Pool {
  pool ??= createDatabasePool(databaseConfig("dev"));
  return pool;
}

function buildServices(databasePool: Pool) {
  const unitOfWork = new MariaDbUnitOfWork(databasePool);
  const identityProvider = new LocalIdentityProvider();
  const hub = new HubKnowledgeCommandServiceImpl(unitOfWork);
  const queries = new KnowledgeQueryServiceImpl(unitOfWork);
  const sources = new SourceApplicationService(unitOfWork);
  const workspaces = new WorkspaceQueryService(unitOfWork);
  return { identityProvider, unitOfWork, hub, queries, sources, workspaces };
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
