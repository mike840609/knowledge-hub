import { expect, it, vi } from "vitest";
import { MariaDbPersonalStore } from "@/infrastructure/database/mariadb/repositories/personal-items";

it("asks the database for favorite rows only", async () => {
  const query = vi.fn(async () => []);
  const store = new MariaDbPersonalStore({ query } as never);
  await store.listFavorites("user", "workspace");
  expect(query.mock.calls[0][0]).toContain("item_key LIKE 'favorite:%'");
  expect(query.mock.calls[0][0]).not.toContain("draft:");
});
