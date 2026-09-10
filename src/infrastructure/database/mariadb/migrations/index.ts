import { coreMigration } from "./001-core";
import { currentRevisionMigration } from "./002-current-revision";
import { requiredLifecycleActorsMigration } from "./003-required-lifecycle-actors";

export const migrations = [coreMigration, currentRevisionMigration, requiredLifecycleActorsMigration] as const;
