import type { Migration } from "./types";

/**
 * A share link may open a whole Source instead of one document or folder.
 * Additive: existing links keep their `document_id`/`folder_node_id` and a
 * NULL `source_id`; the CHECK keeps exactly one target per row. Forward-only.
 */
export const sourceShareLinksMigration: Migration = {
  version: 35,
  name: "source-share-links",
  statements: [
    `ALTER TABLE document_share_links DROP CONSTRAINT ck_share_links_one_target`,
    `ALTER TABLE document_share_links
      ADD COLUMN source_id UUID NULL AFTER folder_node_id,
      ADD CONSTRAINT fk_share_links_source FOREIGN KEY (source_id) REFERENCES knowledge_sources(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      ADD KEY idx_share_links_source (source_id, created_at)`,
    `ALTER TABLE document_share_links
      ADD CONSTRAINT ck_share_links_one_target
      CHECK ((document_id IS NULL) + (folder_node_id IS NULL) + (source_id IS NULL) = 2)`,
  ],
};
