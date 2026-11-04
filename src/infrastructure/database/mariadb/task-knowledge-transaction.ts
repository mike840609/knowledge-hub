import type { Pool, PoolConnection } from "mariadb";
import { DatabaseUnavailableError } from "@/modules/task-knowledge/domain/task-errors";
import type { TaskKnowledgeRepositories, TaskKnowledgeUnitOfWork } from "@/modules/task-knowledge/ports/unit-of-work";
import { DomainError } from "@/shared/domain/errors";
import { createTaskKnowledgeRepositories } from "./repositories/task-knowledge";
import { mapDatabaseError } from "./repositories/shared";

/**
 * Task knowledge's own transaction over the composition root's pool, whose
 * `initSql` sets READ COMMITTED; the lock protocol (design §6) relies on it.
 */
export class MariaDbTaskKnowledgeUnitOfWork implements TaskKnowledgeUnitOfWork {
  constructor(private readonly pool: Pool) {}

  async run<T>(work: (repositories: TaskKnowledgeRepositories) => Promise<T>): Promise<T> {
    let connection: PoolConnection;
    try {
      connection = await this.pool.getConnection();
    } catch {
      // Outside any transaction, so mapDatabaseError never sees it; nothing was written.
      throw new DatabaseUnavailableError();
    }
    try {
      await connection.beginTransaction();
      const result = await work(createTaskKnowledgeRepositories(connection));
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
}
