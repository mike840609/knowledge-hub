import type { Migration } from './types';
export const autosaveHistoryMigration: Migration = {
  version: 23, name: 'autosave-history', statements: [
    `ALTER TABLE knowledge_revisions
      ADD COLUMN history_state VARCHAR(16) NOT NULL DEFAULT 'CHECKPOINT',
      ADD COLUMN history_activity_id UUID NULL,
      ADD COLUMN history_window_started_at DATETIME(6) NULL,
      ADD COLUMN version_name VARCHAR(120) NULL,
      ADD COLUMN history_reason VARCHAR(16) NOT NULL DEFAULT 'LEGACY',
      ADD KEY ix_revision_history (document_id, history_state, revision_no)`,
  ],
};
