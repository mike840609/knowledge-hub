import { expect, it, vi } from "vitest";
import { MariaDbSyncRunRepository } from "@/infrastructure/database/mariadb/repositories/sync-runs";
import type { QueryConnection } from "@/infrastructure/database/mariadb/repositories/shared";

function fakeRepository() {
  const query = vi.fn().mockResolvedValue([]);
  const repository = new MariaDbSyncRunRepository({ query } as unknown as QueryConnection);
  return { repository, query };
}

const ids = (count: number) => Array.from({ length: count }, (_, index) => `source-${index}`);

it("probes each source once per statement in 50-source chunks", async () => {
  const { repository, query } = fakeRepository();

  await repository.listLatestBySourceIds(ids(51));

  expect(query).toHaveBeenCalledTimes(2);
  const [firstSql, firstParams] = query.mock.calls[0] as [string, string[]];
  const [secondSql, secondParams] = query.mock.calls[1] as [string, string[]];
  expect(firstParams).toHaveLength(50);
  expect(firstSql.match(/ORDER BY started_at DESC, id DESC LIMIT 1/g)).toHaveLength(50);
  expect(firstSql).not.toContain("ROW_NUMBER");
  expect(secondParams).toEqual(["source-50"]);
  expect(secondSql.match(/ORDER BY started_at DESC, id DESC LIMIT 1/g)).toHaveLength(1);
});

it("collapses duplicate ids so a chunk boundary cannot return a source twice", async () => {
  const { repository, query } = fakeRepository();

  await repository.listLatestBySourceIds(["source-a", "source-a", "source-b"]);

  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0]![1]).toEqual(["source-a", "source-b"]);
});

it("filters APPLIED and orders by completion time in the probe shape", async () => {
  const { repository, query } = fakeRepository();

  await repository.listLatestAppliedBySourceIds(["source-a", "source-b"]);

  const [sql, params] = query.mock.calls[0] as [string, string[]];
  expect(params).toEqual(["source-a", "source-b"]);
  expect(sql.match(/status = 'APPLIED'/g)).toHaveLength(2);
  expect(sql.match(/ORDER BY completed_at DESC, id DESC LIMIT 1/g)).toHaveLength(2);
});

it("returns an empty result without querying for empty input", async () => {
  const { repository, query } = fakeRepository();

  await expect(repository.listLatestBySourceIds([])).resolves.toEqual([]);
  await expect(repository.listLatestAppliedBySourceIds([])).resolves.toEqual([]);
  expect(query).not.toHaveBeenCalled();
});
