import mariadb, { type Pool, type PoolConnection } from "mariadb";
import type { DatabaseConfig } from "./config";

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
  });
}

export type DatabaseConnection = PoolConnection;
