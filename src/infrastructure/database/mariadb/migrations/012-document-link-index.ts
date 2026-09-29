import type { Migration } from "./types";

/**
 * Document link index (personal-workspace graph spec §7).
 *
 * Derived data, and rebuildable: nothing here decides who may read what, so
 * emptying both tables changes which relationships are *shown*, never which
 * documents are *reachable*.
 *
 * - The tables carry no workspace or source: scope is derived through
 *   Document → Source → Workspace, never stored twice.
 * - `knowledge_link_index` is one row per indexed document, recording which
 *   revision its edges were extracted from. An index row is valid only while
 *   that revision is still the document's current one, which is how a document
 *   with no links is told apart from one nobody has indexed yet.
 * - `knowledge_document_links` stores the *raw* edges — what was written, not
 *   what it resolved to. What a name resolves to depends on which documents
 *   exist and what they are called today, and moving or renaming a document
 *   creates no revision, so storing the resolution would go stale without a
 *   write anywhere near it.
 * - Everything is RESTRICT, like the rest of the schema. Replacing a
 *   document's edges deletes its child rows first and is not a deletion of
 *   Knowledge.
 */
export const documentLinkIndexMigration: Migration = {
  version: 12,
  name: "document-link-index",
  statements: [
    `CREATE TABLE knowledge_link_index (
      document_id UUID NOT NULL,
      revision_id UUID NOT NULL,
      extractor_version SMALLINT UNSIGNED NOT NULL,
      link_count INT UNSIGNED NOT NULL,
      indexed_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      PRIMARY KEY (document_id),
      CONSTRAINT fk_link_index_revision FOREIGN KEY (document_id, revision_id) REFERENCES knowledge_revisions (document_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      KEY idx_link_index_revision (revision_id)
    ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE knowledge_document_links (
      document_id UUID NOT NULL,
      ordinal INT UNSIGNED NOT NULL,
      link_kind VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      target_text VARCHAR(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      target_fragment VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
      display_text VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
      line_no INT UNSIGNED NOT NULL,
      PRIMARY KEY (document_id, ordinal),
      CONSTRAINT fk_document_links_index FOREIGN KEY (document_id) REFERENCES knowledge_link_index (document_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ck_document_links_kind CHECK (link_kind IN ('WIKI', 'PATH')),
      CONSTRAINT ck_document_links_target_nonempty CHECK (CHAR_LENGTH(target_text) > 0),
      CONSTRAINT ck_document_links_line_positive CHECK (line_no > 0)
    ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
};
