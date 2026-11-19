import { describe, expect, it, vi } from "vitest";
import { MariaDbKnowledgeSearchRepository } from "@/infrastructure/database/mariadb/repositories/knowledge-search";
import type { QueryConnection } from "@/infrastructure/database/mariadb/repositories/shared";
import { SearchTimeoutError } from "@/modules/knowledge/domain/errors";
import type { KnowledgeSearchCriteria } from "@/modules/knowledge/ports/knowledge-search-repository";

/** Spec §6.6: `SET STATEMENT max_statement_time=5 FOR ...` is interrupted with
 * a top-level `errno: 1969`, which the repository must fold into SearchTimeoutError. */
const criteria: KnowledgeSearchCriteria = {
  terms: ["needle"], workspaceIds: ["workspace-1"], sourceId: null, includeArchived: false, limit: 21, offset: 0,
};

describe("MariaDbKnowledgeSearchRepository timeout mapping", () => {
  it("maps a top-level errno 1969 to SearchTimeoutError", async () => {
    const query = vi.fn().mockRejectedValue(Object.assign(new Error("Query execution was interrupted"), { errno: 1969 }));
    const repository = new MariaDbKnowledgeSearchRepository({ query } as unknown as QueryConnection);

    await expect(repository.search(criteria)).rejects.toBeInstanceOf(SearchTimeoutError);
  });

  it("propagates a non-timeout database error unchanged, not as a SearchTimeoutError", async () => {
    const original = Object.assign(new Error("Unknown column 'r.title2'"), { errno: 1054 });
    const query = vi.fn().mockRejectedValue(original);
    const repository = new MariaDbKnowledgeSearchRepository({ query } as unknown as QueryConnection);

    await expect(repository.search(criteria)).rejects.toBe(original);
  });

  it("propagates a driver error carrying no errno unchanged", async () => {
    const original = new Error("connection reset");
    const query = vi.fn().mockRejectedValue(original);
    const repository = new MariaDbKnowledgeSearchRepository({ query } as unknown as QueryConnection);

    await expect(repository.search(criteria)).rejects.toBe(original);
  });

  it("hides a block link's Markdown target comment from the returned snippet", async () => {
    const snippet = "Before.\n<!-- kh-block-f81d4fae-7dec-11d0-a765-00a0c91e6bf7 -->\nAfter.";
    const query = vi.fn().mockResolvedValue([{
      document_id: "document-1", source_id: "source-1", workspace_id: "workspace-1",
      title: "Title", page_icon: null, source_name: "Notes", workspace_name: "Workspace",
      status: "ACTIVE", updated_at: new Date("2026-11-18T00:00:00Z"),
      anchor_at: 0, markdown_length: [...snippet].length, snippet,
    }]);
    const repository = new MariaDbKnowledgeSearchRepository({ query } as unknown as QueryConnection);

    const [row] = await repository.search(criteria);

    expect(row.snippet).toContain("Before.");
    expect(row.snippet).toContain("After.");
    expect(row.snippet).not.toContain("kh-block");
    expect(row.snippetClipped).toEqual({ start: false, end: false });
  });
});
