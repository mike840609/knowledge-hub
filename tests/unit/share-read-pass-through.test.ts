import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readShared: vi.fn() }));
vi.mock("@/server/composition", () => ({ shareReadService: () => ({ readShared: mocks.readShared }) }));

import { getSharedDocument, isSharedDocumentAvailable } from "@/server/share-read";
import { ShareLinkNotFoundError } from "@/modules/knowledge/domain/document-share-link";

const token = "6f1c2c9e-4c5e-4b8a-9d2e-3a1b2c3d4e5f";
afterEach(() => vi.clearAllMocks());

describe("the shared page counts a view, the pass-through to the Hub does not", () => {
  it("the page's read counts a view", async () => {
    mocks.readShared.mockResolvedValue({ title: "T" });
    await getSharedDocument(token);
    expect(mocks.readShared).toHaveBeenCalledWith(token, { recordView: true });
  });

  it("the pass-through judges the link without counting, and says whether it opens", async () => {
    mocks.readShared.mockResolvedValueOnce({ title: "T" }).mockRejectedValueOnce(new ShareLinkNotFoundError());
    await expect(isSharedDocumentAvailable(token)).resolves.toBe(true);
    await expect(isSharedDocumentAvailable(token)).resolves.toBe(false);
    expect(mocks.readShared.mock.calls).toEqual([[token, { recordView: false }], [token, { recordView: false }]]);
  });

  it("/s/:token/open passes through, never reading the page's counted projection", () => {
    const page = readFileSync("src/app/s/[token]/open/page.tsx", "utf8");
    expect(page).toMatch(/isSharedDocumentAvailable\(token\)/);
    expect(page).not.toMatch(/getSharedDocument/);
  });
});
