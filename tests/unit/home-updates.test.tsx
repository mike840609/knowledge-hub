import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeUpdates } from "@/components/knowledge/home-updates";
import type { FolderUpdatesPage } from "@/modules/personal/application/list-folder-updates";

it("shows unread changes only and keeps the newest revision per document", () => {
  const run = { id: "run", sourceId: "source", triggeredBy: "user", basedOnVersion: 0, resultVersion: 1, status: "APPLIED" as const, summary: {}, startedAt: new Date("2026-10-17T00:00:00Z"), completedAt: null };
  const change = { id: "change", runId: "run", sourceId: "source", workspaceId: "ws", ordinal: 1, kind: "DOCUMENT" as const, labels: [], sourcePath: "note.md", previousPath: null, title: "Unread note", documentId: "doc", beforeRevisionId: null, afterRevisionId: "revision", beforeRevisionNo: null, afterRevisionNo: 2, diagnostics: [], unread: true };
  const page: FolderUpdatesPage = { nextCursor: null, runs: [{ run, sourceName: "Folder", totalChanges: 3, added: 0, updated: 3, changes: [change, { ...change, id: "older", title: "Old revision", afterRevisionNo: 1 }, { ...change, documentId: "read", title: "Already read", unread: false }] }] };
  const html = renderToStaticMarkup(<HomeUpdates workspaceId="ws" page={page} />);
  expect(html).toContain("Unread note");
  expect(html).toContain("?revision=2");
  expect(html).not.toContain("Old revision");
  expect(html).not.toContain("Already read");
});

it("uses a compact empty state without old read updates", () => {
  expect(renderToStaticMarkup(<HomeUpdates workspaceId="ws" page={{ runs: [], nextCursor: null }} />)).toContain("No new knowledge updates.");
});
