import { describe, expect, it, vi } from "vitest";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { DocumentSummary } from "@/modules/knowledge/ports/tree-repository";
import { recentDocumentHits } from "@/server/recent-documents";

const CALLER = callerFromIdentity({ id: "0199f400-0000-7000-8000-0000000012a1", emp_id: "RECENT-1", name: "Recent Reader", org_code: "RD" });
const WORKSPACE_ID = "0199f400-0000-7000-8000-0000000012a2";
const SOURCE_ID = "0199f400-0000-7000-8000-0000000012a3";

function summary(documentId: string, pageIcon: string | null = null): DocumentSummary {
  return {
    documentId,
    sourceId: SOURCE_ID,
    title: `Title ${documentId}`,
    updatedAt: new Date("2026-10-24T09:00:00Z"),
    ownership: "HUB_MANAGED",
    status: "ACTIVE",
    sourceStatus: "ACTIVE",
    pageIcon,
  };
}

/**
 * The palette reads the recent IDs in one batch and keeps the order the browser
 * supplied. The fake queries service records both calls so the test can pin that
 * only one batch is made and the source list is still read for names.
 */
function fakeServices(summaries: DocumentSummary[] = [summary("b"), summary("a", "📌")]) {
  const listSources = vi.fn(async () => [{ id: SOURCE_ID, name: "Source" }]);
  const listDocumentSummariesByIds = vi.fn(async () => summaries);
  const services = { queries: { listSources, listDocumentSummariesByIds } };
  return { services, listSources, listDocumentSummariesByIds };
}

describe("recent document hits", () => {
  it("reads one batch and returns the asked-for documents in the order supplied", async () => {
    const { services, listSources, listDocumentSummariesByIds } = fakeServices();

    const hits = await recentDocumentHits(services as never, CALLER, WORKSPACE_ID, ["a", "missing", "b"]);

    expect(hits.map((hit) => hit.documentId)).toEqual(["a", "b"]);
    expect(hits).toEqual([
      { documentId: "a", sourceId: SOURCE_ID, title: "Title a", sourceName: "Source", pageIcon: "📌" },
      { documentId: "b", sourceId: SOURCE_ID, title: "Title b", sourceName: "Source", pageIcon: null },
    ]);
    expect(listDocumentSummariesByIds).toHaveBeenCalledTimes(1);
    expect(listDocumentSummariesByIds).toHaveBeenCalledWith(CALLER, WORKSPACE_ID, ["a", "missing", "b"]);
    expect(listSources).toHaveBeenCalledTimes(1);
  });

  it("makes no batch call for an empty ID list while still checking workspace access", async () => {
    const { services, listSources, listDocumentSummariesByIds } = fakeServices();

    await expect(recentDocumentHits(services as never, CALLER, WORKSPACE_ID, [])).resolves.toEqual([]);

    expect(listDocumentSummariesByIds).not.toHaveBeenCalled();
    // `listSources` is the call that refuses a non-member, so an empty list must not skip it.
    expect(listSources).toHaveBeenCalledTimes(1);
  });

  it("leaves out a document the batch did not return", async () => {
    const { services } = fakeServices([]);

    await expect(recentDocumentHits(services as never, CALLER, WORKSPACE_ID, ["gone"])).resolves.toEqual([]);
  });
});
