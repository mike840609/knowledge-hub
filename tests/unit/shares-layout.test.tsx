import { expect, it, vi } from "vitest";

const notFound = vi.hoisted(() => vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }));
const access = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/server/shares-read", () => ({
  requireSharesAccess: access,
  getFollowedDiscussions: vi.fn(),
  sharesNotFound: (error: { code?: string }) => error.code === "DOCUMENT_NOT_FOUND",
}));

import SharesLayout from "@/app/w/[workspaceId]/shares/layout";

it("does not draw the Shares chrome for a workspace the caller cannot manage", async () => {
  access.mockRejectedValueOnce(Object.assign(new Error("no"), { code: "DOCUMENT_NOT_FOUND" }));
  await expect(SharesLayout({ params: Promise.resolve({ workspaceId: "ws" }), children: null })).rejects.toThrow("NEXT_NOT_FOUND");
  expect(notFound).toHaveBeenCalledOnce();
});
