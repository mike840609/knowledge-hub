import { expect, it, vi } from "vitest";
import { MariaDbRevisionRepository } from "@/infrastructure/database/mariadb/repositories/revisions";
import type { QueryConnection } from "@/infrastructure/database/mariadb/repositories/shared";

it("reads only current titles, not full Markdown revisions", async () => {
  const query = vi.fn().mockResolvedValue([{ document_id: "doc-a", title: "Example" }]);
  const repo = new MariaDbRevisionRepository({ query } as unknown as QueryConnection);
  expect([...await repo.findCurrentTitlesByIds(["doc-a", "missing"])]).toEqual([["doc-a", "Example"]]);
  expect(query).toHaveBeenCalledTimes(1);
  const sql: string = query.mock.calls[0][0];
  expect(sql).toContain("r.title");
  expect(sql).not.toContain("r.*");
  expect(sql).not.toContain("r.markdown");
  expect(query.mock.calls[0][1]).toEqual(["doc-a", "missing"]);
});
it("does not issue a title query when the input is empty", async () => {
  const query = vi.fn();
  const repo = new MariaDbRevisionRepository({ query } as unknown as QueryConnection);
  expect((await repo.findCurrentTitlesByIds([])).size).toBe(0);
  expect(query).not.toHaveBeenCalled();
});
