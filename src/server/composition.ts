import { DocumentReviewService } from "@/modules/knowledge/application/document-review-service";
import { AuthUnavailableError } from "@/modules/identity/domain/identity-session-errors";
import { reviewWritesEnabled } from "./config";
import { PersonalPreferencesService } from "@/modules/personal/application/personal-preferences-service";
import { PersonalProfileService } from "@/modules/personal/application/personal-profile-service";
import { AgentContextService } from "@/modules/knowledge/application/agent-context-service";
import { GetImportScopeService } from "@/modules/sources/application/get-import-scope";
import {GetSourceHealthService} from "@/modules/sources/application/get-source-health";
import { ListFolderUpdatesService } from "@/modules/personal/application/list-folder-updates";
import { GetSyncRunDetailService } from "@/modules/sources/application/get-sync-run-detail";
import { GetFolderImportDiffService } from "@/modules/sources/application/get-folder-import-diff";
import { DocumentReadProgressService } from "@/modules/personal/application/document-read-progress-service";
import { PersonalService } from "@/modules/personal/application/personal-service";
import { MariaDbPersonalStore } from "@/infrastructure/database/mariadb/repositories/personal-items";
import { WorkspaceAdminService } from "./workspace-admin";
import { TeamWorkspaceService } from "@/modules/workspaces/application/team-workspace-service";
import { TeamGovernanceService } from "@/modules/workspaces/application/team-governance-service";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { KnowledgeQueryServiceImpl } from "@/modules/knowledge/application/knowledge-query-service";
import { KnowledgeSearchService } from "@/modules/knowledge/application/knowledge-search-service";
import { KnowledgeLinkServiceImpl } from "@/modules/knowledge/application/knowledge-link-service";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { DocumentShareService } from "@/modules/knowledge/application/document-share-service";
import { RandomShareTokenIssuer } from "@/infrastructure/security/random-share-token-issuer";
import { AbandonFolderImportService } from "@/modules/sources/application/abandon-folder-import";
import { ApplyFolderImportService } from "@/modules/sources/application/apply-folder-import";
import { ImportMemoryBudget } from "@/modules/sources/application/import-memory-budget";
import { CreateFolderImportService } from "@/modules/sources/application/create-folder-import";
import { CleanupFolderImportsService } from "@/modules/sources/application/cleanup-folder-imports";
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
  // The slot is the single source of truth — no module-level mirror — so a
  // future one-sided edit can't reintroduce the HMR pool leak.
  const slot = globalThis as unknown as GlobalPoolSlot;
  slot.__kmDbPool ??= createDatabasePool(databaseConfig("dev"));
  return slot.__kmDbPool;
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
  const links = new KnowledgeLinkServiceImpl(unitOfWork);
  const documentReadProgress = new DocumentReadProgressService(unitOfWork, queries);
  const personalPreferences = new PersonalPreferencesService(new MariaDbPersonalStore(databasePool), unitOfWork);
  const personal = new PersonalService(new MariaDbPersonalStore(databasePool), queries, unitOfWork);
  const reviews = new DocumentReviewService(unitOfWork, undefined, reviewWritesEnabled);
  const shares = new DocumentShareService(unitOfWork, new RandomShareTokenIssuer());
  const sources = new SourceApplicationService(unitOfWork);
  const workspaceAdmin = new WorkspaceAdminService(unitOfWork);
  const teams = new TeamWorkspaceService(unitOfWork);
  const governance = new TeamGovernanceService(unitOfWork);
  const workspaces = new WorkspaceQueryService(unitOfWork);
  const search = new KnowledgeSearchService(unitOfWork, workspaces);
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
      readiness ??= verifyReadiness().catch(() => {
        readiness = undefined;
        throw new AuthUnavailableError();
      });
      await readiness;
    }
    const trusted = await establishTrustedCallerWith({ provider: identityProvider, resolver, personalWorkspaces, unitOfWork });
    if (process.env.KM_TEAM_WORKSPACES_ENABLED !== "true") {
      trusted.caller.personalWorkspaceOnly = trusted.personalWorkspace.id;
    }
    return trusted;
  };
  const importConfig = importRuntimeConfig();
  // One budget for both phases, sized to one import at the Markdown limit (import-memory-budget.ts).
  // ponytail: `next dev` HMR builds a fresh one per reload; harmless outside dev.
  const memoryBudget = new ImportMemoryBudget(importConfig.limits.maxMarkdownTotalBytes);
  const imports = {
    abandon: new AbandonFolderImportService(unitOfWork),
    create: new CreateFolderImportService(unitOfWork, { limits: importConfig.limits, buildingTtlMs: importConfig.buildingTtlMs }),
    upload: new UploadFolderImportEntriesService(unitOfWork, { limits: importConfig.limits }),
    finalize: new FinalizeFolderImportService(unitOfWork, { limits: importConfig.limits, readyTtlMs: importConfig.readyTtlMs, memoryBudget }),
    preview: new GetFolderImportPreviewService(unitOfWork),
    diff: new GetFolderImportDiffService(unitOfWork),
    apply: new ApplyFolderImportService(unitOfWork, { memoryBudget }),
    cleanup: new CleanupFolderImportsService(unitOfWork),
  };
  return {
    personalProfile: new PersonalProfileService(unitOfWork),
    agentContext: new AgentContextService(unitOfWork),
    importScope: new GetImportScopeService(unitOfWork), sourceHealth:new GetSourceHealthService(unitOfWork), folderUpdates:new ListFolderUpdatesService(unitOfWork), syncReading: new GetSyncRunDetailService(unitOfWork), documentReadProgress, personal, personalPreferences, workspaceAdmin, teams, governance, reviewReadAvailable: true, verifyProductionReadiness: verifyReadiness, identityProvider, unitOfWork, resolver, personalWorkspaces, establishTrustedCaller, hub, queries, links, shares, reviews, sources, workspaces, search, imports };
}

export function applicationServices() {
  services ??= buildApplicationServices(getPool(), { companySessionReader });
  return services;
}

/**
 * The `/s/:token` entry (share-link spec §6.1). It deliberately bypasses
 * applicationServices(): building those constructs the identity provider,
 * which throws when Company SSO has no session reader, and the reader of a
 * share link has no identity at all. Only the unit of work is needed.
 */
export function shareReadService(): Pick<DocumentShareService, "readShared"> {
  return new DocumentShareService(new MariaDbUnitOfWork(getPool()), new RandomShareTokenIssuer());
}

/** Token-scoped public review projection, independent of identity-provider setup. */
export function reviewReadService(): Pick<DocumentReviewService, "queryForLink"> {
  return new DocumentReviewService(new MariaDbUnitOfWork(getPool()));
}

/** Verify the same provider/session dependencies used by request handling. */
export async function verifyProductionReadiness(options: {
  rolloutHubUserIds?: readonly string[];
} = {}): Promise<ProductionReadinessSummary> {
  return applicationServices().verifyProductionReadiness(options.rolloutHubUserIds);
}

export async function closeApplicationPool(): Promise<void> {
  const slot = globalThis as unknown as GlobalPoolSlot;
  if (slot.__kmDbPool) await slot.__kmDbPool.end();
  delete slot.__kmDbPool;
  services = undefined;
  companySessionReader = undefined;
}
