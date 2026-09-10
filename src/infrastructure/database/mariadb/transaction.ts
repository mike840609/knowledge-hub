import type { Pool } from "mariadb";
import type { KnowledgeUnitOfWork } from "@/modules/knowledge/ports/unit-of-work";
import type { SourceUnitOfWork, SourceRepositories } from "@/modules/sources/ports/unit-of-work";
import { DomainError } from "@/modules/knowledge/domain/errors";
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
}
