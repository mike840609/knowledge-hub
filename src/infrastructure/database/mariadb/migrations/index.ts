import { coreMigration } from "./001-core";
import { currentRevisionMigration } from "./002-current-revision";
import { requiredLifecycleActorsMigration } from "./003-required-lifecycle-actors";
import { treeMappingMigration } from "./004-phase-1-tree-mapping";
import { treeMappingConstraintsMigration } from "./005-phase-1-tree-mapping-constraints";

export const migrations = [coreMigration, currentRevisionMigration, requiredLifecycleActorsMigration, treeMappingMigration, treeMappingConstraintsMigration] as const;
