import type { Migration } from "./types";
// Additive/forward-only rollout: rollback application code without dropping review history.
export const documentReviewMigration:Migration={version:17,name:"document-review",statements:[
`CREATE TABLE document_review_threads (
 id UUID NOT NULL PRIMARY KEY, document_id UUID NOT NULL, created_revision_id UUID NOT NULL, created_by UUID NOT NULL,
 creation_idempotency_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, creation_request_hash CHAR(64) CHARACTER SET ascii NOT NULL,
 origin_share_link_id UUID NULL, anchor_json JSON NOT NULL,
 status ENUM('OPEN','RESOLVED') NOT NULL DEFAULT 'OPEN', visibility ENUM('VISIBLE','HIDDEN') NOT NULL DEFAULT 'VISIBLE',
 hidden_by UUID NULL, hidden_at DATETIME(6) NULL, hidden_reason VARCHAR(200) NULL,
 resolved_by UUID NULL, resolved_at DATETIME(6) NULL, created_at DATETIME(6) NOT NULL, updated_at DATETIME(6) NOT NULL,
 UNIQUE KEY uq_review_creation (document_id,created_by,creation_idempotency_key),
 KEY ix_review_document_status (document_id,status,created_at), KEY ix_review_creator (created_by,created_at),
 FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE RESTRICT,
 FOREIGN KEY (created_revision_id) REFERENCES knowledge_revisions(id) ON DELETE RESTRICT,
 FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
 FOREIGN KEY (origin_share_link_id) REFERENCES document_share_links(id) ON DELETE RESTRICT,
 FOREIGN KEY (hidden_by) REFERENCES users(id) ON DELETE RESTRICT, FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE RESTRICT,
 CHECK ((status='OPEN' AND resolved_by IS NULL AND resolved_at IS NULL) OR (status='RESOLVED' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)),
 CHECK ((visibility='VISIBLE' AND hidden_by IS NULL AND hidden_at IS NULL AND hidden_reason IS NULL) OR (visibility='HIDDEN' AND hidden_by IS NOT NULL AND hidden_at IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE document_review_comments (
 id UUID NOT NULL PRIMARY KEY, thread_id UUID NOT NULL, author_user_id UUID NOT NULL, body TEXT NOT NULL,
 visibility ENUM('VISIBLE','HIDDEN') NOT NULL DEFAULT 'VISIBLE', hidden_by UUID NULL, hidden_at DATETIME(6) NULL, hidden_reason VARCHAR(200) NULL,
 created_at DATETIME(6) NOT NULL, idempotency_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, request_hash CHAR(64) CHARACTER SET ascii NOT NULL,
 UNIQUE KEY uq_review_reply (thread_id,author_user_id,idempotency_key), KEY ix_review_comments (thread_id,created_at,id),
 FOREIGN KEY (thread_id) REFERENCES document_review_threads(id) ON DELETE RESTRICT,
 FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE RESTRICT, FOREIGN KEY (hidden_by) REFERENCES users(id) ON DELETE RESTRICT,
 CHECK ((visibility='VISIBLE' AND hidden_by IS NULL AND hidden_at IS NULL AND hidden_reason IS NULL) OR (visibility='HIDDEN' AND hidden_by IS NOT NULL AND hidden_at IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE document_review_write_events (
 id UUID NOT NULL PRIMARY KEY, user_id UUID NOT NULL, document_id UUID NOT NULL, created_at DATETIME(6) NOT NULL,
 KEY ix_review_write_window (user_id,document_id,created_at), KEY ix_review_write_cleanup (created_at),
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT, FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
]};
