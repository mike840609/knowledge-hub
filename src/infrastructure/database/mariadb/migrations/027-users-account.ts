import type { Migration } from "./types";

/**
 * Company SSO account names. Nullable because existing Hub users and
 * local/Google identities have no company account. The unique B-tree index
 * also serves future prefix autocomplete for mentions.
 */
export const usersAccountMigration: Migration = {
  version: 27,
  name: "users-account",
  statements: [
    `ALTER TABLE users
      ADD COLUMN account VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL AFTER emp_id,
      ADD CONSTRAINT uq_users_account UNIQUE (account),
      ADD CONSTRAINT ck_users_account_nonempty CHECK (account IS NULL OR CHAR_LENGTH(account) > 0)`,
  ],
};
