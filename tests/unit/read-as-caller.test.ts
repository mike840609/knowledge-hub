import { describe, expect, it, vi } from "vitest";
import { readAsCaller } from "@/modules/identity/application/sync-caller-identity";
import { callerFromIdentity, type CallerContext } from "@/modules/identity/domain/caller-context";

const identity = { id: "u-reader", emp_id: "READER", name: "Reader", org_code: "ORG" };
const synced: CallerContext = { ...callerFromIdentity(identity), identitySynced: true };
const unsynced = callerFromIdentity(identity);

type Repositories = { tag: string };
type UnitOfWork = {
  read<U>(work: (repositories: Repositories) => Promise<U>): Promise<U>;
  run<U>(work: (repositories: Repositories) => Promise<U>): Promise<U>;
};

function fakeUnitOfWork() {
  const repositories: Repositories = { tag: "repositories" };
  const read = vi.fn(async (work: (r: Repositories) => Promise<unknown>) => work(repositories));
  const run = vi.fn(async (work: (r: Repositories) => Promise<unknown>) => work(repositories));
  return { read, run, unitOfWork: { read, run } as unknown as UnitOfWork };
}

describe("readAsCaller", () => {
  it("reads without a transaction for a synced caller", async () => {
    const { read, run, unitOfWork } = fakeUnitOfWork();

    const result = await readAsCaller(unitOfWork, synced, async (repositories) => repositories.tag);

    expect(result).toBe("repositories");
    expect(read).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs inside a transaction for an unsynced caller", async () => {
    const { read, run, unitOfWork } = fakeUnitOfWork();

    const result = await readAsCaller(unitOfWork, unsynced, async (repositories) => repositories.tag);

    expect(result).toBe("repositories");
    expect(run).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
  });

  it("passes a failure through from the read path", async () => {
    const { read, run, unitOfWork } = fakeUnitOfWork();
    const failure = new Error("read failed");

    await expect(readAsCaller(unitOfWork, synced, async () => { throw failure; })).rejects.toBe(failure);
    expect(read).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });

  it("passes a failure through from the transactional path", async () => {
    const { read, run, unitOfWork } = fakeUnitOfWork();
    const failure = new Error("run failed");

    await expect(readAsCaller(unitOfWork, unsynced, async () => { throw failure; })).rejects.toBe(failure);
    expect(run).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
  });
});
