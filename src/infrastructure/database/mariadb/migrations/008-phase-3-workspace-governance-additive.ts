import type { Migration } from "./types";

/**
 * Phase 3 additive/compatibility schema (migration 008).
 *
 * Additive only: new nullable columns, new tables, and safe indexes/FKs.
 * Nothing here finalizes NOT NULL on legacy writer fields, adds workspace
 * type/lifecycle CHECKs, or canonical User FKs on the new governance
 * columns — migration 009 owns the final constraints after the governance,
 * identity-link, and Personal backfill bootstraps complete under write
 * quiescence.
 *
 * - `workspaces.workspace_type` stays NULLable; legacy rows are explicitly
 *   backfilled to TEAM (never guessed from name/org/row order).
 * - `personal_owner_user_id` is NULLable but UNIQUE immediately, so Personal
 *   provisioning/backfill is DB-protected from 008 onward. MariaDB NULLable
 *   UNIQUE permits multiple NULLs, so legacy TEAM rows coexist safely.
 * - `workspace_memberships.role` / `membership_source` stay NULLable until
 *   the Team role/owner bootstrap runs (pre-bootstrap reads stay NULL).
 * - `external_identity_links` pins exact `(provider, subject_bytes)` bytes
 *   (VARBINARY, no trim/lowercase/normalize) plus one-subject-per-Hub-user
 *   per provider.
 * - `workspace_group_mappings` roles exclude OWNER at the DB boundary
 *   (TEAM-only enforcement lives in application governance, Task 3+).
 */
export const phase3WorkspaceGovernanceAdditiveMigration: Migration = {
  version: 8,
  name: "phase-3-workspace-governance-additive",
  statements: [
    `ALTER TABLE workspaces
      ADD COLUMN workspace_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
      ADD COLUMN personal_owner_user_id UUID NULL,
      ADD COLUMN lifecycle_state VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
      ADD COLUMN created_by UUID NULL,
      ADD COLUMN archived_by UUID NULL,
      ADD COLUMN archived_at DATETIME(6) NULL,
      ADD CONSTRAINT uq_workspaces_personal_owner UNIQUE (personal_owner_user_id)`,
    "UPDATE workspaces SET workspace_type = 'TEAM' WHERE workspace_type IS NULL",
    `ALTER TABLE workspace_memberships
      ADD COLUMN role VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
      ADD COLUMN membership_source VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL`,
    `CREATE TABLE external_identity_links (
      id UUID NOT NULL,
      provider VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      subject_bytes VARBINARY(1024) NOT NULL,
      hub_user_id UUID NOT NULL,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      last_seen_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      CONSTRAINT uq_identity_links_provider_subject UNIQUE (provider, subject_bytes),
      CONSTRAINT uq_identity_links_provider_hub_user UNIQUE (provider, hub_user_id),
      CONSTRAINT fk_identity_links_hub_user FOREIGN KEY (hub_user_id) REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ck_identity_links_provider_nonempty CHECK (CHAR_LENGTH(provider) > 0),
      KEY idx_identity_links_hub_user (hub_user_id)
    ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE workspace_group_mappings (
      id UUID NOT NULL,
      workspace_id UUID NOT NULL,
      external_group_id VARBINARY(512) NOT NULL,
      role VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      created_by UUID NULL,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      CONSTRAINT uq_group_mappings_workspace_group UNIQUE (workspace_id, external_group_id),
      CONSTRAINT fk_group_mappings_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT fk_group_mappings_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ck_group_mappings_role CHECK (role IN ('ADMIN', 'EDITOR', 'VIEWER')),
      KEY idx_group_mappings_workspace (workspace_id)
    ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE workspace_audit_events (
      id UUID NOT NULL,
      workspace_id UUID NOT NULL,
      actor_user_id UUID NULL,
      actor_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      event_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      target_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
      target_id UUID NULL,
      payload JSON NULL,
      correlation_id UUID NULL,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      CONSTRAINT fk_audit_events_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT fk_audit_events_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ck_audit_events_payload_json CHECK (payload IS NULL OR JSON_VALID(payload)),
      KEY idx_audit_events_workspace_created (workspace_id, created_at),
      KEY idx_audit_events_actor (actor_user_id)
    ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
};
