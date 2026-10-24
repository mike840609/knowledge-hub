import { expect, it, vi } from "vitest";
import { MariaDbPersonalStore } from "@/infrastructure/database/mariadb/repositories/personal-items";

it("asks the database for favorite rows only", async () => {
  const query = vi.fn<(sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>>(async () => []);
  const store = new MariaDbPersonalStore({ query } as never);
  await store.listFavorites("user", "workspace");
  const sql = query.mock.calls[0][0];
  expect(sql).toContain("item_key LIKE 'favorite:%'");
  expect(sql).not.toContain("draft:");
});
