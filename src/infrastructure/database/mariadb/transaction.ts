import type { Pool } from "mariadb";
import type { KnowledgeUnitOfWork } from "@/modules/knowledge/ports/unit-of-work";
import type { SourceUnitOfWork, SourceRepositories } from "@/modules/sources/ports/unit-of-work";
import { DomainError } from "@/modules/knowledge/domain/errors";
import { importError } from "@/modules/sources/domain/import-errors";
import { creatorQuotaLockName } from "./repositories/import-snapshots";
import { createRepositories } from "./repositories";
import { mapDatabaseError } from "./repositories/shared";

export class MariaDbUnitOfWork implements KnowledgeUnitOfWork, SourceUnitOfWork {
  constructor(private readonly pool: Pool) {}

  async run<T>(work: (repositories: SourceRepositories) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
      await connection.beginTransaction();
      const repositories = createRepositories(connection);
      const result = await work(repositories);
      await connection.commit();
      return result;
    } catch (error) {
      try { await connection.rollback(); } catch { /* preserve the original failure */ }
      if (error instanceof DomainError) throw error;
      throw mapDatabaseError(error);
    } finally {
      connection.release();
    }
  }

  async runWithCreatorQuotaLock<T>(
    creatorId: string,
    timeoutSeconds: number,
    work: (repositories: SourceRepositories) => Promise<T>,
  ): Promise<T> {
    const connection = await this.pool.getConnection();
    const lockName = creatorQuotaLockName(creatorId);
    try {
      await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
      const acquired = await connection.query<{ acquired: unknown }[]>("SELECT GET_LOCK(?, ?) AS acquired", [lockName, timeoutSeconds]);
      if (Number(acquired[0]?.acquired ?? 0) !== 1) {
        throw importError("IMPORT_APPLY_RETRYABLE", "Import quota could not be checked; retry the request.");
      }
      try {
        await connection.beginTransaction();
        const repositories = createRepositories(connection);
        const result = await work(repositories);
        await connection.commit();
        return result;
      } catch (error) {
        try { await connection.rollback(); } catch { /* preserve the original failure */ }
        if (error instanceof DomainError) throw error;
        throw mapDatabaseError(error);
      } finally {
        await connection.query("SELECT RELEASE_LOCK(?)", [lockName]);
      }
    } finally {
      connection.release();
    }
  }
}
