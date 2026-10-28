import type { Migration } from "./types";

/**
 * A page's icon, beside its title. Additive and nullable: every existing page
 * keeps the file glyph until someone chooses an icon, and clearing it returns
 * the page to the same state.
 */
export const documentPageIconMigration: Migration = {
  version: 26,
  name: "document-page-icon",
  statements: [
    "ALTER TABLE knowledge_documents ADD COLUMN page_icon VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER status",
  ],
};
