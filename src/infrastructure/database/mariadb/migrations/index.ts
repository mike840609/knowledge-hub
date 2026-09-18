import { coreMigration } from "./001-core";
import { currentRevisionMigration } from "./002-current-revision";
import { requiredLifecycleActorsMigration } from "./003-required-lifecycle-actors";
import { treeMappingMigration } from "./004-phase-1-tree-mapping";
import { treeMappingConstraintsMigration } from "./005-phase-1-tree-mapping-constraints";
import { phase2ImportStagingMigration } from "./006-phase-2-import-staging";
import { phase2AssetProjectionMigration } from "./007-phase-2-asset-projection";
import { phase3WorkspaceGovernanceAdditiveMigration } from "./008-phase-3-workspace-governance-additive";
import { phase3WorkspaceGovernanceFinalizeMigration } from "./009-phase-3-workspace-governance-finalize";
import { phase2StableSourceIdentityMigration } from "./010-phase-2-stable-source-identity";

export const migrations = [
  coreMigration,
  currentRevisionMigration,
  requiredLifecycleActorsMigration,
  treeMappingMigration,
  treeMappingConstraintsMigration,
  phase2ImportStagingMigration,
  phase2AssetProjectionMigration,
  phase3WorkspaceGovernanceAdditiveMigration,
  phase3WorkspaceGovernanceFinalizeMigration,
  phase2StableSourceIdentityMigration,
] as const;
