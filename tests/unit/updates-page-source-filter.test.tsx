import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const pageState = vi.hoisted(() => ({
  sources: [] as unknown[],
  getFolderUpdates: vi.fn(),
}));

vi.mock("@/server/sync-reading", () => ({ getFolderUpdates: pageState.getFolderUpdates }));
vi.mock("@/server/composition", () => ({
  applicationServices: () => ({
    establishTrustedCaller: async () => ({ caller: { identity: { id: "0199f400-0000-7000-8000-0000000009a1" } } }),
    queries: { listSources: async () => pageState.sources },
  }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  useRouter: () => ({ replace: vi.fn() }),
}));

import UpdatesPage from "@/app/w/[workspaceId]/updates/page";

const WORKSPACE_ID = "0199f400-0000-7000-8000-0000000009a2";

function source(id: string, name: string, sourceType: "FOLDER_SYNC" | "FILE_UPLOAD" | "HUB", status: "ACTIVE" | "ARCHIVED") {
  return { id, workspaceId: WORKSPACE_ID, name, sourceType, status, ownership: "SOURCE_MANAGED", syncVersion: 1 };
}

describe("Updates folder filter", () => {
  beforeEach(() => {
    pageState.sources = [];
    pageState.getFolderUpdates.mockReset();
    pageState.getFolderUpdates.mockResolvedValue({ runs: [], nextCursor: null });
  });

  it("lists archived folder sources and only FOLDER_SYNC sources", async () => {
    pageState.sources = [
      source("source-archived", "Archived Folder", "FOLDER_SYNC", "ARCHIVED"),
      source("source-active", "Active Folder", "FOLDER_SYNC", "ACTIVE"),
      source("source-hub", "Team Hub", "HUB", "ACTIVE"),
      source("source-upload", "Uploaded Files", "FILE_UPLOAD", "ACTIVE"),
    ];

    const html = renderToStaticMarkup(
      await UpdatesPage({ params: Promise.resolve({ workspaceId: WORKSPACE_ID }), searchParams: Promise.resolve({}) }),
    );

    expect(html).toContain('value="source-archived"');
    expect(html).toContain("Archived Folder");
    expect(html).toContain('value="source-active"');
    expect(html).toContain("Active Folder");
    expect(html).not.toContain("Team Hub");
    expect(html).not.toContain("Uploaded Files");
    expect(pageState.getFolderUpdates).toHaveBeenCalledWith(WORKSPACE_ID, {
      sourceId: undefined,
      unreadOnly: false,
      limit: 20,
      cursor: undefined,
    });
  });

  it("applies a filter as it is chosen and keeps a Filter button only for a page without JavaScript", async () => {
    const html = renderToStaticMarkup(
      await UpdatesPage({ params: Promise.resolve({ workspaceId: WORKSPACE_ID }), searchParams: Promise.resolve({ unread: "true" }) }),
    );

    expect(html).toMatch(new RegExp(`<form [^>]*action="/w/${WORKSPACE_ID}/updates"`));
    expect(html).toMatch(/<input type="checkbox" name="unread" checked="" value="true"\/>/);
    expect(html.match(/<button[^>]*type="submit"/g) ?? []).toHaveLength(1);
    expect(html).toMatch(/<noscript><button[^>]*type="submit"[^>]*>Filter<\/button><\/noscript>/);
  });
});
