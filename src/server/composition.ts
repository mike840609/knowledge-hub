import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { KnowledgeQueryServiceImpl } from "@/modules/knowledge/application/knowledge-query-service";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { ApplyFolderImportService } from "@/modules/sources/application/apply-folder-import";
import { CreateFolderImportService } from "@/modules/sources/application/create-folder-import";
import { FinalizeFolderImportService } from "@/modules/sources/application/finalize-folder-import";
import { GetFolderImportPreviewService } from "@/modules/sources/application/get-folder-import-preview";
import { UploadFolderImportEntriesService } from "@/modules/sources/application/upload-folder-import-entries";
import { SourceApplicationService } from "@/modules/sources/application/source-version-guard";
import { WorkspaceQueryService } from "@/modules/workspaces/application/workspace-query-service";
import { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import {
  assertProductionReadiness,
  type ProductionReadinessSummary,
} from "@/modules/workspaces/application/workspace-readiness";
import type { CompanySsoSessionReader } from "@/modules/identity/ports/company-sso-session-reader";
import { companySsoProviderName, companySsoRolloutHubUserIds, identityProviderKind } from "./config";
import { HubIdentityResolver } from "@/modules/identity/application/hub-identity-resolver";
import { establishTrustedCaller as establishTrustedCallerWith } from "@/server/trusted-caller";
import { importRuntimeConfig } from "@/server/import-config";
import { createIdentityProvider } from "@/server/identity-provider-factory";

let pool: Pool | undefined;
let services: ReturnType<typeof buildServices> | undefined;

function getPool(): Pool {
  pool ??= createDatabasePool(databaseConfig("dev"));
  return pool;
}

function buildServices(databasePool: Pool) {
  const unitOfWork = new MariaDbUnitOfWork(databasePool);
  const identityProvider = createIdentityProvider();
  const hub = new HubKnowledgeCommandServiceImpl(unitOfWork);
  const queries = new KnowledgeQueryServiceImpl(unitOfWork);
  const sources = new SourceApplicationService(unitOfWork);
  const workspaces = new WorkspaceQueryService(unitOfWork);
  const resolver = new HubIdentityResolver(unitOfWork);
  const personalWorkspaces = new PersonalWorkspaceService(unitOfWork);
  const establishTrustedCaller = () =>
    establishTrustedCallerWith({ provider: identityProvider, resolver, personalWorkspaces, unitOfWork });
  const importConfig = importRuntimeConfig();
  const imports = {
    create: new CreateFolderImportService(unitOfWork, { limits: importConfig.limits, buildingTtlMs: importConfig.buildingTtlMs }),
    upload: new UploadFolderImportEntriesService(unitOfWork, { limits: importConfig.limits }),
    finalize: new FinalizeFolderImportService(unitOfWork, { limits: importConfig.limits, readyTtlMs: importConfig.readyTtlMs }),
    preview: new GetFolderImportPreviewService(unitOfWork),
    apply: new ApplyFolderImportService(unitOfWork),
  };
  return { identityProvider, unitOfWork, resolver, personalWorkspaces, establishTrustedCaller, hub, queries, sources, workspaces, imports };
}

export function applicationServices() {
  services ??= buildServices(getPool());
  return services;
}

/**
 * Production cutover readiness (spec §19 step 8). The production boot path
 * must await this before serving traffic: 009 APPLIED, Company SSO provider
 * configured, a server-side session reader wired, and rollout-scope legacy
 * identity links complete. Fails closed; the Company SSO session adapter is
 * passed in once it exists, so an unwired deployment can never report ready.
 */
export async function verifyProductionReadiness(options: {
  companySessionReader?: CompanySsoSessionReader;
  rolloutHubUserIds?: readonly string[];
} = {}): Promise<ProductionReadinessSummary> {
  const databasePool = getPool();
  return assertProductionReadiness({
    query: async <T>(sql: string, params?: unknown[]): Promise<T> => databasePool.query(sql, params) as Promise<T>,
    identityProviderKind: identityProviderKind(),
    companySsoProvider: companySsoProviderName(),
    companySessionReaderConfigured: options.companySessionReader !== undefined,
    rolloutHubUserIds: options.rolloutHubUserIds ?? companySsoRolloutHubUserIds(),
  });
}

export async function closeApplicationPool(): Promise<void> {
  if (pool) await pool.end();
  pool = undefined;
  services = undefined;
}
