import { describe, expect, it, vi } from "vitest";
import type { Pool } from "mariadb";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { DomainError } from "@/modules/knowledge/domain/errors";
import { WorkspaceBusyError } from "@/shared/domain/errors";

function harness() {
  const connection = {
    beginTransaction: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
    release: vi.fn(),
  };
  const pool = { getConnection: vi.fn(async () => connection) } as unknown as Pool;
  return { connection, pool, unitOfWork: new MariaDbUnitOfWork(pool) };
}

describe("MariaDbUnitOfWork.read", () => {
  it("runs SELECT-only work on a pooled connection without beginning or committing a transaction, and releases it", async () => {
    const { connection, pool, unitOfWork } = harness();

    const result = await unitOfWork.read(async (repositories) => {
      expect(repositories.documents.findById).toBeTypeOf("function");
      return "read-result";
    });

    expect(result).toBe("read-result");
    expect(pool.getConnection).toHaveBeenCalledTimes(1);
    expect(connection.beginTransaction).not.toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it("releases the connection when the work fails, still without a transaction", async () => {
    const { connection, unitOfWork } = harness();

    await expect(unitOfWork.read(async () => { throw new Error("boom"); }))
      .rejects.toThrow("Database operation failed.");

    expect(connection.beginTransaction).not.toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it("rethrows a DomainError as-is", async () => {
    const { connection, unitOfWork } = harness();
    const failure = new DomainError("TEST_FAILURE", "already a domain answer");

    await expect(unitOfWork.read(async () => { throw failure; })).rejects.toBe(failure);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it("maps any other failure through mapDatabaseError", async () => {
    const { unitOfWork } = harness();

    await expect(unitOfWork.read(async () => {
      throw Object.assign(new Error("Deadlock found"), { code: "ER_LOCK_DEADLOCK", errno: 1213 });
    })).rejects.toBeInstanceOf(WorkspaceBusyError);
  });

  it("leaves run transactional: it still begins, commits and releases", async () => {
    const { connection, unitOfWork } = harness();

    await expect(unitOfWork.run(async () => "run-result")).resolves.toBe("run-result");

    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
  });
});
