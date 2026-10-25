import { beforeEach, describe, expect, it, vi } from "vitest";

const createPool = vi.hoisted(() => vi.fn(() => ({}) as never));
vi.mock("mariadb", () => ({ default: { createPool } }));

import { createDatabasePool, SESSION_INIT_SQL } from "@/infrastructure/database/mariadb/pool";
import type { DatabaseConfig } from "@/infrastructure/database/mariadb/config";

const config: DatabaseConfig = {
  host: "db.example.com",
  port: 3306,
  user: "user",
  password: "password",
  database: "knowledge_hub",
  connectionLimit: 2,
  connectTimeout: 1000,
  acquireTimeout: 1000,
  ssl: false,
};

beforeEach(() => createPool.mockClear());

describe("createDatabasePool", () => {
  it("disables query pipelining so a connection pooler cannot close the socket", () => {
    // Layerbase's pooled endpoint drops the connection when a transaction sends
    // several queries without waiting for the previous result
    // (ER_SOCKET_UNEXPECTED_CLOSE). `Promise.all` inside a unit of work relies
    // on pipelining, so it has to be off for every pooled deployment.
    createDatabasePool(config);

    expect(createPool).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelining: false,
        initSql: SESSION_INIT_SQL,
        minimumIdle: 0,
        idleTimeout: 60,
        connectionLimit: 2,
        timezone: "Z",
      }),
    );
  });
});
