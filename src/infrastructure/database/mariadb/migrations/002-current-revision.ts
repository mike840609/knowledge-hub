import type { Migration } from "./types";

export const currentRevisionMigration: Migration = {
  version: 2,
  name: "current-revision-reference",
  statements: [
    `ALTER TABLE knowledge_documents
      ADD CONSTRAINT fk_documents_current_revision_same_document
      FOREIGN KEY (id, current_revision_id)
      REFERENCES knowledge_revisions(document_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT`,
  ],
};
