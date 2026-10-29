import type { Migration } from "./types";

/**
 * Company SSO profile fields. `account` is nullable because existing Hub users
 * and local/Google identities have no company account; its unique B-tree index
 * also serves future prefix autocomplete for mentions. `name_en` is a nullable
 * English display name and has no write path in this change.
 */
export const usersAccountMigration: Migration = {
  version: 27,
  name: "users-account",
  statements: [
    `ALTER TABLE users
      ADD COLUMN account VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL AFTER emp_id,
      ADD COLUMN name_en VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER name,
      ADD CONSTRAINT uq_users_account UNIQUE (account),
      ADD CONSTRAINT ck_users_account_nonempty CHECK (account IS NULL OR CHAR_LENGTH(account) > 0),
      ADD CONSTRAINT ck_users_name_en_nonempty CHECK (name_en IS NULL OR CHAR_LENGTH(name_en) > 0)`,
  ],
};
