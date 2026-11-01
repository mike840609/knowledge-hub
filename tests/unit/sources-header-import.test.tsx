import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

const injected = vi.hoisted(() => ({
  model: null as unknown,
}));

vi.mock("@/server/source-read", () => ({
  getSourceListModel: async () => injected.model,
}));
vi.mock("@/server/import-config", () => ({
  importRuntimeConfig: () => ({
    limits: { maxMarkdownFileBytes: 1, maxAssetFileBytes: 1, maxAssetTotalBytes: 1 },
  }),
}));
vi.mock("@/server/composition", () => ({
  applicationServices: () => ({
    establishTrustedCaller: async () => ({ caller: {} }),
    personalPreferences: { get: async () => null },
  }),
}));
vi.mock("@/components/shell/workspace-import-link", () => ({
  WorkspaceImportLink: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} data-import-link {...props}>{children}</a>
  ),
}));
vi.mock("@/components/sources/source-list", () => ({
  SourceList: () => <div data-source-list="" />,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import WorkspaceSourcesPage from "@/app/w/[workspaceId]/sources/page";

const item = { source: { id: "s1", name: "HCM KM", status: "ACTIVE" } };

function model(type: "PERSONAL" | "TEAM") {
  return {
    workspace: { id: "w1", name: "HCM Team", type, lifecycleState: "ACTIVE" },
    items: [item],
  };
}

async function render(type: "PERSONAL" | "TEAM"): Promise<string> {
  injected.model = model(type);
  return renderToStaticMarkup(await WorkspaceSourcesPage({
    params: Promise.resolve({ workspaceId: "w1" }),
  }));
}

describe("Sources page header", () => {
  it("offers no Import folder in a team, even when a publication is listed", async () => {
    const html = await render("TEAM");
    expect(html).toContain("HCM Team");
    expect(html).not.toContain("Import folder");
    expect(html).not.toContain("data-import-link");
  });

  it("still offers Import folder in My Space", async () => {
    const html = await render("PERSONAL");
    expect(html).toContain("Import folder");
    expect(html).toContain('href="/w/w1/sources/import"');
  });
});
