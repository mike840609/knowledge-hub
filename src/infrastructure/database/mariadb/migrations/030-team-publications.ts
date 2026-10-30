import type { Migration } from "./types";

/**
 * Team space publishing: publications, contributors, projected team documents,
 * per-contribution claims, the event log and per-target delivery progress.
 *
 * Scope is derived, never stored twice: a publication names its team source and
 * takes name/workspace/lifecycle from the joined `knowledge_sources` row. A
 * team document is an ordinary `knowledge_documents` row in that source; the
 * publication tables only add the creator and the original's path.
 */
export const teamPublicationsMigration: Migration = {
  version: 30,
  name: "team-publications",
  statements: [
    // A publication is a source; this row adds only kind and creator.
    `CREATE TABLE publications (
      id UUID NOT NULL,
      source_id UUID NOT NULL,
      kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      creator_user_id UUID NOT NULL,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      CONSTRAINT uq_publications_source UNIQUE (source_id),
      CONSTRAINT fk_publications_source FOREIGN KEY (source_id) REFERENCES knowledge_sources(id) ON DELETE RESTRICT,
      CONSTRAINT fk_publications_creator FOREIGN KEY (creator_user_id) REFERENCES users(id) ON DELETE RESTRICT,
      CONSTRAINT ck_publications_kind CHECK (kind IN ('FOLDER', 'DOCUMENT'))
    ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Active publication names are unique per team; archived ones free the name.
    `ALTER TABLE knowledge_sources
      ADD COLUMN active_publication_name VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
        GENERATED ALWAYS AS (CASE WHEN source_type = 'PUBLICATION' AND status = 'ACTIVE' THEN name ELSE NULL END) STORED,
      ADD CONSTRAINT uq_sources_active_publication_name UNIQUE (workspace_id, active_publication_name)`,

    // Extend the source type/ownership matrix without rewriting migration 001.
    `ALTER TABLE knowledge_sources DROP CONSTRAINT ck_sources_type_ownership`,
    `ALTER TABLE knowledge_sources ADD CONSTRAINT ck_sources_type_ownership CHECK (
      (source_type = 'FOLDER_SYNC' AND ownership = 'SOURCE_MANAGED')
      OR (source_type IN ('FILE_UPLOAD', 'HUB') AND ownership = 'HUB_MANAGED')
      OR (source_type = 'PUBLICATION' AND ownership = 'SOURCE_MANAGED')
    )`,

    // A contributor comes from one of their own folders, or one document.
    // Leave, rights freeze and pending catch-up are independent facts.
    `CREATE TABLE publication_contributors (
      id UUID NOT NULL,
      publication_id UUID NOT NULL,
      user_id UUID NOT NULL,
      origin_folder_node_id UUID NULL,
      origin_document_id UUID NULL,
      left_at DATETIME(6) NULL,
      rights_frozen_at DATETIME(6) NULL,
      pending_catch_up TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      CONSTRAINT uq_publication_contributors_user UNIQUE (publication_id, user_id),
      CONSTRAINT fk_publication_contributors_publication FOREIGN KEY (publication_id) REFERENCES publications(id) ON DELETE RESTRICT,
      CONSTRAINT fk_publication_contributors_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
      CONSTRAINT fk_publication_contributors_folder FOREIGN KEY (origin_folder_node_id) REFERENCES knowledge_tree_nodes(id) ON DELETE RESTRICT,
      CONSTRAINT fk_publication_contributors_document FOREIGN KEY (origin_document_id) REFERENCES knowledge_documents(id) ON DELETE RESTRICT,
      CONSTRAINT ck_publication_contributors_origin CHECK ((origin_folder_node_id IS NULL) <> (origin_document_id IS NULL)),
      CONSTRAINT ck_publication_contributors_pending CHECK (pending_catch_up IN (0, 1))
    ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // A team copy of one original. source_path is the publication-relative
    // Folder Sync path; NULL for Hub-written documents, which reserve nothing.
    // path_hash lets the unique index compare exact bytes (case included);
    // the adapter still re-reads source_path, so a hash match is never identity.
    `CREATE TABLE publication_documents (
      team_document_id UUID NOT NULL,
      publication_id UUID NOT NULL,
      creator_contribution_id UUID NOT NULL,
      current_original_document_id UUID NOT NULL,
      source_path TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
      path_hash BINARY(32) GENERATED ALWAYS AS (UNHEX(SHA2(source_path, 256))) STORED,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      PRIMARY KEY (team_document_id),
      CONSTRAINT uq_publication_documents_path UNIQUE (publication_id, path_hash),
      CONSTRAINT fk_publication_documents_team FOREIGN KEY (team_document_id) REFERENCES knowledge_documents(id) ON DELETE RESTRICT,
      CONSTRAINT fk_publication_documents_publication FOREIGN KEY (publication_id) REFERENCES publications(id) ON DELETE RESTRICT,
      CONSTRAINT fk_publication_documents_creator FOREIGN KEY (creator_contribution_id) REFERENCES publication_contributors(id) ON DELETE RESTRICT,
      CONSTRAINT fk_publication_documents_original FOREIGN KEY (current_original_document_id) REFERENCES knowledge_documents(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Remembered original → team copy per contribution. The active workspace
    // key is the uniqueness claim for "one original, one team document per
    // team"; archive clears it, restore re-claims it in the same transaction.
    // It is a claim key only, never an authorization input.
    `CREATE TABLE publication_bindings (
      contribution_id UUID NOT NULL,
      original_document_id UUID NOT NULL,
      team_document_id UUID NOT NULL,
      active_team_workspace_id UUID NULL,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      PRIMARY KEY (contribution_id, original_document_id),
      CONSTRAINT uq_publication_bindings_claim UNIQUE (original_document_id, active_team_workspace_id),
      CONSTRAINT fk_publication_bindings_contribution FOREIGN KEY (contribution_id) REFERENCES publication_contributors(id) ON DELETE RESTRICT,
      CONSTRAINT fk_publication_bindings_original FOREIGN KEY (original_document_id) REFERENCES knowledge_documents(id) ON DELETE RESTRICT,
      CONSTRAINT fk_publication_bindings_team FOREIGN KEY (team_document_id) REFERENCES knowledge_documents(id) ON DELETE RESTRICT,
      CONSTRAINT fk_publication_bindings_workspace FOREIGN KEY (active_team_workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Sources of team updates. revision_id is event data, not a FK: a working
    // revision may be pruned while the event is still unread, and consumption
    // always re-reads the current revision instead of trusting the payload.
    `CREATE TABLE publication_events (
      id UUID NOT NULL,
      document_id UUID NULL,
      tree_node_id UUID NULL,
      source_id UUID NULL,
      kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      revision_id UUID NULL,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      consumed_at DATETIME(6) NULL,
      PRIMARY KEY (id),
      CONSTRAINT fk_publication_events_document FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE RESTRICT,
      CONSTRAINT fk_publication_events_tree FOREIGN KEY (tree_node_id) REFERENCES knowledge_tree_nodes(id) ON DELETE RESTRICT,
      CONSTRAINT fk_publication_events_source FOREIGN KEY (source_id) REFERENCES knowledge_sources(id) ON DELETE RESTRICT,
      CONSTRAINT ck_publication_events_kind CHECK (kind IN ('REVISION', 'TREE', 'LIFECYCLE', 'SOURCE')),
      CONSTRAINT ck_publication_events_target CHECK (
        (document_id IS NOT NULL) + (tree_node_id IS NOT NULL) + (source_id IS NOT NULL) = 1
      ),
      KEY ix_publication_events_unconsumed (consumed_at, created_at)
    ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Every affected contribution completes on its own; a pending target keeps
    // the root event unconsumed so being behind stays detectable.
    `CREATE TABLE publication_event_deliveries (
      event_id UUID NOT NULL,
      contribution_id UUID NOT NULL,
      processed_at DATETIME(6) NULL,
      outcome VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
      PRIMARY KEY (event_id, contribution_id),
      CONSTRAINT fk_publication_event_deliveries_event FOREIGN KEY (event_id) REFERENCES publication_events(id) ON DELETE RESTRICT,
      CONSTRAINT fk_publication_event_deliveries_contribution FOREIGN KEY (contribution_id) REFERENCES publication_contributors(id) ON DELETE RESTRICT,
      CONSTRAINT ck_publication_event_deliveries_outcome CHECK (outcome IS NULL OR outcome IN ('APPLIED', 'SKIPPED')),
      KEY ix_publication_event_deliveries_pending (processed_at, contribution_id)
    ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // The latest reconcile notices, readable after an asynchronous apply.
    `CREATE TABLE publication_reconcile_reports (
      contribution_id UUID NOT NULL,
      report_json JSON NOT NULL,
      updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      PRIMARY KEY (contribution_id),
      CONSTRAINT fk_publication_reconcile_reports_contribution FOREIGN KEY (contribution_id) REFERENCES publication_contributors(id) ON DELETE RESTRICT,
      CONSTRAINT ck_publication_reconcile_reports_json CHECK (JSON_VALID(report_json))
    ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Team discussion has no share link. NULL origin/recipient fields are valid
    // only for a team publication; services and adapters validate the context,
    // so NULL never becomes an anonymous grant.
    `ALTER TABLE share_comment_events
      ADD COLUMN recipient_user_id UUID NULL,
      MODIFY COLUMN origin_share_link_id UUID NULL,
      ADD CONSTRAINT fk_share_comment_events_recipient FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE RESTRICT`,

    `ALTER TABLE review_comment_mentions MODIFY COLUMN share_link_id UUID NULL`,
  ],
};
