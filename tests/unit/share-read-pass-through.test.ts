import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readShared: vi.fn() }));
vi.mock("@/server/composition", () => ({ shareReadService: () => ({ readShared: mocks.readShared }) }));

import { getShared, isSharedAvailable } from "@/server/share-read";
import { ShareLinkNotFoundError } from "@/modules/knowledge/domain/document-share-link";

const token = "6f1c2c9e-4c5e-4b8a-9d2e-3a1b2c3d4e5f";
const documentId = "0192f3a4-5b6c-7d8e-9f01-23456789abcd";
afterEach(() => vi.clearAllMocks());

describe("the shared page counts a view, the pass-through to the Hub does not", () => {
  it("the page's read counts a view", async () => {
    mocks.readShared.mockResolvedValue({ kind: "DOCUMENT", title: "T" });
    await getShared(token);
    expect(mocks.readShared).toHaveBeenCalledWith(token, { documentId: undefined, recordView: true });
  });

  it("a folder page's read passes the document it navigates to, and counts a view", async () => {
    mocks.readShared.mockResolvedValue({ kind: "FOLDER" });
    await getShared(token, documentId);
    expect(mocks.readShared).toHaveBeenCalledWith(token, { documentId, recordView: true });
  });

  it("every unusable link or document reads as null", async () => {
    mocks.readShared.mockRejectedValue(new ShareLinkNotFoundError());
    await expect(getShared(token, documentId)).resolves.toBeNull();
  });

  it("the pass-through judges the link without counting, and says whether it opens", async () => {
    mocks.readShared.mockResolvedValueOnce({ kind: "DOCUMENT", title: "T" }).mockRejectedValueOnce(new ShareLinkNotFoundError());
    await expect(isSharedAvailable(token)).resolves.toBe(true);
    await expect(isSharedAvailable(token, documentId)).resolves.toBe(false);
    expect(mocks.readShared.mock.calls).toEqual([[token, { documentId: undefined, recordView: false }], [token, { documentId, recordView: false }]]);
  });

  it("/s/:token/open passes through, never reading the page's counted projection", () => {
    const page = readFileSync("src/app/s/[token]/open/page.tsx", "utf8");
    expect(page).toMatch(/isSharedAvailable\(token\)/);
    expect(page).not.toMatch(/getShared\b/);
  });
});
