import type { Migration } from "./types";

/**
 * A share link may open a My Space folder instead of one document. Additive:
 * existing links keep `document_id` and a NULL `folder_node_id`; the CHECK
 * keeps exactly one target per row.
 */
export const folderShareLinksMigration: Migration = {
  version: 27,
  name: "folder-share-links",
  statements: [
    `ALTER TABLE document_share_links MODIFY document_id UUID NULL,
      ADD COLUMN folder_node_id UUID NULL AFTER document_id,
      ADD CONSTRAINT fk_share_links_folder FOREIGN KEY (folder_node_id) REFERENCES knowledge_tree_nodes(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      ADD CONSTRAINT ck_share_links_one_target CHECK ((document_id IS NULL) <> (folder_node_id IS NULL)),
      ADD KEY idx_share_links_folder (folder_node_id, created_at)`,
  ],
};
