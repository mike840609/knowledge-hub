import mariadb, { type Pool, type PoolConnection } from "mariadb";
import type { DatabaseConfig } from "./config";

/**
 * Every transaction runs READ COMMITTED. Set once per connection rather than
 * before each transaction, which cost a round trip every time. A pool built
 * any other way must run this too, or its transactions fall back to the
 * server default (REPEATABLE READ).
 */
export const SESSION_ISOLATION_SQL = "SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED";

export function createDatabasePool(config: DatabaseConfig): Pool {
  return mariadb.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionLimit: config.connectionLimit ?? 10,
    acquireTimeout: 10_000,
    connectTimeout: 10_000,
    timezone: "Z",
    bigIntAsNumber: true,
    insertIdAsNumber: true,
    initSql: SESSION_ISOLATION_SQL,
  });
}

export type DatabaseConnection = PoolConnection;
