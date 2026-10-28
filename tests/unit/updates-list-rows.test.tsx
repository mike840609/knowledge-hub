import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { UpdatesList } from "@/components/knowledge/updates-list";
import type { FolderUpdatesPage } from "@/modules/personal/application/list-folder-updates";

function change(id: string, title: string, unread: boolean, label: "ADDED" | "UPDATED") {
  return { id, documentId: `doc-${id}`, title, unread, labels: [label], sourcePath: `${id}.md`, afterRevisionNo: 2 };
}

function page(changes: ReturnType<typeof change>[]): FolderUpdatesPage {
  return {
    runs: [
      {
        run: { id: "run-1", sourceId: "src-1", startedAt: new Date("2026-10-22T00:00:00Z"), completedAt: new Date("2026-10-22T00:00:00Z") },
        sourceName: "Team folder",
        changes,
        totalChanges: changes.length,
        added: 1,
        updated: 1,
      },
    ],
    nextCursor: null,
  } as unknown as FolderUpdatesPage;
}

function rowFor(html: string, title: string) {
  const anchor = html.split("<a ").find((part) => part.includes(`>${title}</span>`));
  if (!anchor) throw new Error(`no row for ${title}`);
  return anchor;
}

describe("Updates rows", () => {
  const html = renderToStaticMarkup(
    <UpdatesList workspaceId="ws" page={page([change("a", "Fresh guide", true, "ADDED"), change("b", "Seen guide", false, "UPDATED")])} />,
  );

  it("marks an unread change with a dot and says Unread to assistive technology", () => {
    const row = rowFor(html, "Fresh guide");
    expect(row).toContain("rounded-full bg-kh-primary");
    expect(row).toContain('<span class="sr-only"> · Unread</span>');
    expect(row).toContain(">Added<");
  });

  it("says nothing about a read change and draws no dot", () => {
    const row = rowFor(html, "Seen guide");
    expect(row).not.toContain("bg-kh-primary");
    expect(row).not.toContain("Unread");
    expect(row).not.toMatch(/>\s*Read\s*</);
    expect(row).toContain(">Updated<");
  });

  it("writes titles and the run heading in text colour, not link colour", () => {
    expect(rowFor(html, "Fresh guide")).toContain("text-kh-text");
    expect(rowFor(html, "Fresh guide")).not.toContain("text-kh-link");
    expect(html).toContain('class="text-body font-medium text-kh-text hover:underline" href="/w/ws/sources/src-1/runs/run-1"');
  });

  it("still links each change to the revision it produced", () => {
    expect(rowFor(html, "Fresh guide")).toContain('href="/w/ws/knowledge/src-1/doc-a?revision=2"');
  });
});
