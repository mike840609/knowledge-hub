import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ActionContext } from "@/components/actions/action-registry";
import { SidebarGetStarted, hasNoDocuments, startActions } from "@/components/knowledge/sidebar-get-started";
import type { KnowledgeTreeItem } from "@/modules/knowledge/application/knowledge-query-service";

const can = { canWrite: true, canImport: true, canSearch: true, canInspectSources: true, canOpenSettings: true };
const context = (overrides: Partial<Omit<ActionContext, "onboarding">> = {}) => ({ workspaceId: "w1", workspaceType: "TEAM" as const, can, confirmed: true, ...overrides });
const render = (overrides: Partial<Omit<ActionContext, "onboarding">> = {}) => renderToStaticMarkup(createElement(SidebarGetStarted, { actions: startActions(context(overrides)) }));
const item = (type: "document" | "folder", status: "ACTIVE" | "ARCHIVED" = "ACTIVE") => ({ id: `${type}-1`, type, status, label: type, documentId: type === "document" ? "d1" : undefined }) as unknown as KnowledgeTreeItem;

describe("sidebar get started", () => {
  it("offers both ways in, each saying what it leads to, linking where the action goes", () => {
    const html = render();
    expect(html).toContain("No documents yet");
    expect(html).toContain('href="/w/w1/knowledge/new"');
    expect(html).toContain('href="/w/w1/sources/import"');
    expect(html).toMatch(/Create document[\s\S]*You can edit it any time/);
    expect(html).toMatch(/Import knowledge[\s\S]*Read-only here; import again to update them/);
  });

  it("leads with writing in a team workspace and with the import in a personal one", () => {
    expect(startActions(context()).map((action) => action.id)).toEqual(["create.document", "create.import"]);
    expect(startActions(context({ workspaceType: "PERSONAL" })).map((action) => action.id)).toEqual(["create.import", "create.document"]);
    expect(render({ workspaceType: "PERSONAL" })).toContain("Import your first knowledge source");
  });

  it("offers only what the reader may do", () => {
    const writeOnly = render({ can: { ...can, canImport: false } });
    expect(writeOnly).toContain("Create document");
    expect(writeOnly).not.toContain("/sources/import");
    const importOnly = render({ can: { ...can, canWrite: false } });
    expect(importOnly).toContain("/sources/import");
    expect(importOnly).not.toContain("/knowledge/new");
  });

  it("says plainly that a reader without edit access cannot add, and offers nothing", () => {
    for (const html of [render({ can: { ...can, canWrite: false, canImport: false } }), render({ confirmed: false })]) {
      expect(html).toContain("adding to it needs edit access");
      expect(html).not.toContain("<a ");
    }
  });

  it("counts a workspace as empty only when no source holds a document, archived ones included", () => {
    expect(hasNoDocuments([])).toBe(true);
    expect(hasNoDocuments([{ tree: [] }, { tree: [item("folder")] }])).toBe(true);
    expect(hasNoDocuments([{ tree: [] }, { tree: [item("document")] }])).toBe(false);
    expect(hasNoDocuments([{ tree: [item("document", "ARCHIVED")] }])).toBe(false);
  });
});
