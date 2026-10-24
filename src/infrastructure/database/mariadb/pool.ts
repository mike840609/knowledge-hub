import mariadb, { type Pool, type PoolConnection } from "mariadb";
import type { DatabaseConfig } from "./config";

/**
 * Every transaction runs READ COMMITTED. Set once per connection rather than
 * before each transaction, which cost a round trip every time. A pool built
 * any other way must run this too, or its transactions fall back to the
 * server default (REPEATABLE READ).
 */
export const SESSION_ISOLATION_SQL = "SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED";

/**
 * The application mixes driver-written UTC dates with server-side
 * CURRENT_TIMESTAMP defaults, so the session has to agree with the driver's
 * `timezone: "Z"`. A deployed database whose host defaults to a local zone
 * would otherwise store offsets the app never intended.
 */
export const SESSION_UTC_SQL = "SET SESSION time_zone = '+00:00'";

export const SESSION_INIT_SQL: string[] = [SESSION_ISOLATION_SQL, SESSION_UTC_SQL];

export function createDatabasePool(config: DatabaseConfig): Pool {
  return mariadb.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionLimit: config.connectionLimit ?? 10,
    // Serverless: do not hold idle sockets open. Layerbase releases idle pooler
    // clients after five minutes and caps them per plan; 60 s keeps us well
    // below both, and a cold wake reconnects instead of failing.
    minimumIdle: 0,
    idleTimeout: 60,
    acquireTimeout: config.acquireTimeout ?? 10_000,
    connectTimeout: config.connectTimeout ?? 10_000,
    timezone: "Z",
    bigIntAsNumber: true,
    insertIdAsNumber: true,
    ssl: config.ssl,
    initSql: SESSION_INIT_SQL,
  });
}

export type DatabaseConnection = PoolConnection;
