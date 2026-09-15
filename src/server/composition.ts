import { WorkspaceAdminService } from "./workspace-admin";
import { TeamWorkspaceService } from "@/modules/workspaces/application/team-workspace-service";
import { TeamGovernanceService } from "@/modules/workspaces/application/team-governance-service";
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
let services: ReturnType<typeof buildApplicationServices> | undefined;
let companySessionReader: CompanySsoSessionReader | undefined;

/** Startup-only dependency registration; never accepts browser identity data. */
export function configureCompanySsoSessionReader(reader: CompanySsoSessionReader): void {
  if (services || companySessionReader) {
    throw new Error("Configure the Company SSO session reader once, before application services are created.");
  }
  companySessionReader = reader;
}

type GlobalPoolSlot = { __kmDbPool?: Pool };

function getPool(): Pool {
  // `next dev` re-evaluates server modules on every HMR reload; a plain
  // module-level singleton would orphan a full pool per reload and exhaust
  // MariaDB max_connections over a session. Pin the pool on globalThis so
  // reloads reuse it; closeApplicationPool() clears the slot for tests.
  const slot = globalThis as unknown as GlobalPoolSlot;
  pool = slot.__kmDbPool ??= createDatabasePool(databaseConfig("dev"));
  return pool;
}

export function buildApplicationServices(databasePool: Pool, options: {
  companySessionReader?: CompanySsoSessionReader;
} = {}) {
  const unitOfWork = new MariaDbUnitOfWork(databasePool);
  const identityProvider = createIdentityProvider(options);
  const providerKind = identityProviderKind();
  const providerName = companySsoProviderName();
  const sessionReaderConfigured = options.companySessionReader !== undefined;
  const hub = new HubKnowledgeCommandServiceImpl(unitOfWork);
  const queries = new KnowledgeQueryServiceImpl(unitOfWork);
  const sources = new SourceApplicationService(unitOfWork);
  const workspaceAdmin = new WorkspaceAdminService(unitOfWork);
  const teams = new TeamWorkspaceService(unitOfWork);
  const governance = new TeamGovernanceService(unitOfWork);
  const workspaces = new WorkspaceQueryService(unitOfWork);
  const resolver = new HubIdentityResolver(unitOfWork);
  const personalWorkspaces = new PersonalWorkspaceService(unitOfWork);
  const verifyReadiness = (rolloutHubUserIds = companySsoRolloutHubUserIds()): Promise<ProductionReadinessSummary> =>
    assertProductionReadiness({
      query: async <T>(sql: string, params?: unknown[]): Promise<T> => databasePool.query(sql, params) as Promise<T>,
      identityProviderKind: providerKind,
      companySsoProvider: providerName,
      companySessionReaderConfigured: sessionReaderConfigured,
      rolloutHubUserIds,
    });
  let readiness: Promise<ProductionReadinessSummary> | undefined;
  const establishTrustedCaller = async () => {
    // Company traffic cannot bypass the startup gate. Cache success for this
    // service instance; a failed cutover check can be retried after repair.
    if (providerKind === "company-sso") {
      readiness ??= verifyReadiness().catch((error: unknown) => {
        readiness = undefined;
        throw error;
      });
      await readiness;
    }
    return establishTrustedCallerWith({ provider: identityProvider, resolver, personalWorkspaces, unitOfWork });
  };
  const importConfig = importRuntimeConfig();
  const imports = {
    create: new CreateFolderImportService(unitOfWork, { limits: importConfig.limits, buildingTtlMs: importConfig.buildingTtlMs }),
    upload: new UploadFolderImportEntriesService(unitOfWork, { limits: importConfig.limits }),
    finalize: new FinalizeFolderImportService(unitOfWork, { limits: importConfig.limits, readyTtlMs: importConfig.readyTtlMs }),
    preview: new GetFolderImportPreviewService(unitOfWork),
    apply: new ApplyFolderImportService(unitOfWork),
  };
  return { workspaceAdmin, teams, governance, verifyProductionReadiness: verifyReadiness, identityProvider, unitOfWork, resolver, personalWorkspaces, establishTrustedCaller, hub, queries, sources, workspaces, imports };
}

export function applicationServices() {
  services ??= buildApplicationServices(getPool(), { companySessionReader });
  return services;
}

/** Verify the same provider/session dependencies used by request handling. */
export async function verifyProductionReadiness(options: {
  rolloutHubUserIds?: readonly string[];
} = {}): Promise<ProductionReadinessSummary> {
  return applicationServices().verifyProductionReadiness(options.rolloutHubUserIds);
}

export async function closeApplicationPool(): Promise<void> {
  if (pool) await pool.end();
  pool = undefined;
  delete (globalThis as unknown as GlobalPoolSlot).__kmDbPool;
  services = undefined;
  companySessionReader = undefined;
}
