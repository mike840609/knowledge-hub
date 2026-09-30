// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrateLocalFavorites, enqueueFavoriteWrite } from "@/lib/favorite-sync";
beforeEach(() => localStorage.clear()); afterEach(() => vi.unstubAllGlobals());
it("migrates old local favorites but respects existing server deletions", async () => {
  localStorage.setItem("kh:document-shortcuts:workspace", JSON.stringify({ favorites: ["source:old", "source:removed"], recent: [] }));
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ version: 0 })).mockResolvedValueOnce(Response.json({ version: 1 })).mockResolvedValueOnce(Response.json({ version: 2, value: null }));
  vi.stubGlobal("fetch", fetcher);
  await migrateLocalFavorites("workspace");
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ key: "favorite:old", version: 0 });
  await migrateLocalFavorites("workspace"); expect(fetcher).toHaveBeenCalledTimes(3);
});
it("serializes writes from independent components", async () => {
  const order: number[] = [];
  let release!: () => void; const held = new Promise<void>(r => { release = r; });
  const a = enqueueFavoriteWrite("queue", async () => { order.push(1); await held; order.push(2); });
  const b = enqueueFavoriteWrite("queue", async () => { order.push(3); });
  await Promise.resolve(); await Promise.resolve(); expect(order).toEqual([1]); release(); await Promise.all([a, b]); expect(order).toEqual([1, 2, 3]);
});
