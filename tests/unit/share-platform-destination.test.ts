import { expect, it, vi } from "vitest";
import { sharePlatformDestination } from "@/server/share-platform-destination";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { DomainError } from "@/shared/domain/errors";
const caller = {} as CallerContext;
it("opens the original document only after normal access checks", async () => {
  const getDocument = vi.fn().mockResolvedValue({ workspaceId: "team", sourceId: "source", documentId: "doc" });
  expect(await sharePlatformDestination(caller, "doc", "personal", { getDocument })).toBe("/w/team/knowledge/source/doc");
  expect(getDocument).toHaveBeenCalledWith(caller, "doc");
});
it.each(["WORKSPACE_ACCESS_DENIED", "DOCUMENT_NOT_FOUND", "SOURCE_NOT_FOUND", "INSUFFICIENT_WORKSPACE_CAPABILITY"])("sends a reader to their own space on %s", async code => {
  expect(await sharePlatformDestination(caller, "doc", "personal", { getDocument: vi.fn().mockRejectedValue(new DomainError(code, "Denied")) })).toBe("/w/personal/home");
});
it("does not hide database failures as missing access", async () => {
  await expect(sharePlatformDestination(caller, "doc", "personal", { getDocument: vi.fn().mockRejectedValue(new Error("database unavailable")) })).rejects.toThrow("database unavailable");
});
