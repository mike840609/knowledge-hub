import { expect, it, vi } from "vitest";
import { MariaDbSyncRunRepository } from "@/infrastructure/database/mariadb/repositories/sync-runs";
import type { QueryConnection } from "@/infrastructure/database/mariadb/repositories/shared";

it("lists Source runs newest first with a limit", async () => {
  const query = vi.fn().mockResolvedValue([]);
  const repository = new MariaDbSyncRunRepository(
    { query } as unknown as QueryConnection,
  );

  await repository.listBySourceId("source-1", 20);

  expect(query).toHaveBeenCalledWith(
    expect.stringContaining("ORDER BY started_at DESC, id DESC"),
    ["source-1", 20],
  );
});

it("filters applied runs before limiting and orders by completion time", async () => {
  const query=vi.fn().mockResolvedValue([]);
  const repository=new MariaDbSyncRunRepository({query} as unknown as QueryConnection);
  await repository.listBySourceId("source-1",1,"APPLIED");
  expect(query).toHaveBeenCalledWith(expect.stringContaining("status = ?"),["source-1","APPLIED",1]);
  expect(query.mock.calls[0][0]).toContain("ORDER BY completed_at DESC, id DESC");
});
