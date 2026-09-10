/**
 * Read-query-only view of the runner connection handed to a migration
 * `beforeApply` hook. The runner rejects any statement that is not a plain
 * read (`SELECT`/`SHOW`/`DESCRIBE`/`EXPLAIN`) before it reaches MariaDB, so a
 * hook can inspect schema/data but cannot write, take locks beyond its own
 * reads, or accept operator input.
 */
export type MigrationReadConnection = {
  query<T>(sql: string, params?: unknown[]): Promise<T>;
};

export type Migration = {
  version: number;
  name: string;
  statements: readonly string[];
  /**
   * Optional fixed code executed under the migration lock after ledger
   * validation but before the RUNNING ledger insertion. Checksum hashing
   * covers `statements` only; the hook must not generate dynamic manifest
   * statements, write data, or read operator input. A hook failure aborts the
   * migration without creating any ledger row for that version.
   */
  beforeApply?: (connection: MigrationReadConnection) => Promise<void>;
};
