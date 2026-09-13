import { coreMigration } from "./001-core";
import { currentRevisionMigration } from "./002-current-revision";
import { requiredLifecycleActorsMigration } from "./003-required-lifecycle-actors";
import { treeMappingMigration } from "./004-phase-1-tree-mapping";
import { treeMappingConstraintsMigration } from "./005-phase-1-tree-mapping-constraints";
import { phase2ImportStagingMigration } from "./006-phase-2-import-staging";
import { phase2AssetProjectionMigration } from "./007-phase-2-asset-projection";

export const migrations = [
  coreMigration,
  currentRevisionMigration,
  requiredLifecycleActorsMigration,
  treeMappingMigration,
  treeMappingConstraintsMigration,
  phase2ImportStagingMigration,
  phase2AssetProjectionMigration,
] as const;
