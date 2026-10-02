import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ESLint } from "eslint";
import { revisionDiff, revisionDiffContext } from "@/lib/revision-diff";
import { prioritizePaletteActions } from "@/lib/palette-actions";
import type { Action } from "@/components/actions/action-registry";
import { ImportChangeGroup } from "@/components/imports/import-change-group";
import { KnowledgeQueryServiceImpl } from "@/modules/knowledge/application/knowledge-query-service";
import type { KnowledgeUnitOfWork, KnowledgeRepositories } from "@/modules/knowledge/ports/unit-of-work";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";

describe("revision comparison", () => {
  it.each([
    ["# Title\nold\nend", "# Title\nnew\nend"], ["", "a"], ["a", ""], ["x\nx\ny", "x\ny\nx"],
    ["a\nb\n", "a\nc\nb\n"], ["same", "same"],
  ])("reconstructs both revisions without losing lines (%s)", (before, after) => {
    const lines = revisionDiff(before, after);
    expect(lines.filter(l => l.kind !== "added").map(l => l.text).join("\n")).toBe(before);
    expect(lines.filter(l => l.kind !== "removed").map(l => l.text).join("\n")).toBe(after);
  });
  it("keeps long unchanged content out of the summary and retains line numbers", () => {
    const before = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 500\n", "changed\n");
    const context = revisionDiffContext(revisionDiff(before, after));
    expect(context.filter(Boolean)).toHaveLength(6);
    expect(context.find(l => l?.kind === "removed")?.before).toBe(501);
    expect(context.find(l => l?.kind === "added")?.after).toBe(501);
  });
  it("bounds comparison work for a large complete rewrite", () => {
    const before = Array.from({ length: 1000 }, (_, i) => `old ${i}`).join("\n");
    const after = Array.from({ length: 1000 }, (_, i) => `new ${i}`).join("\n");
    expect(revisionDiff(before, after).filter(l => l.kind === "added")).toHaveLength(1000);
  });
});

describe("empty palette context", () => {
  const actions = [
    { id: "navigate.knowledge", group: "navigate", effect: { kind: "navigate", href: "/w/w/knowledge" } },
    { id: "navigate.graph", group: "navigate", effect: { kind: "navigate", href: "/w/w/graph" } },
    { id: "create.document", group: "create", effect: { kind: "navigate", href: "/w/w/knowledge/new" } },
    { id: "document.edit", group: "document", effect: { kind: "navigate", href: "/w/w/knowledge/s/d/edit" } },
  ] as Action[];
  it("offers the current document before other destinations, omitting redundant section navigation", () => {
    expect(prioritizePaletteActions(actions, "/w/w/knowledge/s/d", "").map(a => a.id)).toEqual(["document.edit", "create.document", "navigate.graph"]);
  });
  it("retains explicit typed navigation matches", () => {
    expect(prioritizePaletteActions(actions, "/w/w/knowledge/s/d", "knowledge")).toBe(actions);
  });
});

describe("large import presentation", () => {
  it("initially renders 50 of 20,000 changes with an explicit path to the rest", () => {
    const changes = Array.from({ length: 20_000 }, (_, i) => ({ kind: "DOCUMENT" as const, sourcePath: `docs/${i}.md`, previousPath: null, labels: ["ADDED" as const], diagnostics: [] }));
    const html = renderToStaticMarkup(<ImportChangeGroup title="Added" changes={changes} defaultExpanded />);
    expect(html.match(/<li\b/g)).toHaveLength(50);
    expect(html).toContain("50 of 20000");
    expect(html).not.toContain("docs/50.md");
  });
});

describe("authorized metadata-only home query", () => {
  const caller = callerFromIdentity({ id: "u", emp_id: "E", name: "User", org_code: "O" });
  it("does not retrieve summaries when workspace read is refused", async () => {
    const fetch = vi.fn(async () => []);
    const repo = { users: { upsertIdentity: vi.fn() }, workspaceAccess: { requireWorkspaceRead: vi.fn(async () => { throw new Error("refused"); }) }, tree: { listDocumentsByWorkspace: fetch } } as unknown as KnowledgeRepositories;
    const uow = { run: async (work: (r: KnowledgeRepositories) => Promise<unknown>) => work(repo) } as KnowledgeUnitOfWork;
    await expect(new KnowledgeQueryServiceImpl(uow).listDocumentSummaries(caller, "w")).rejects.toThrow("refused");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("design enforcement", () => {
  it("rejects arbitrary style tokens in literal and interpolated classes and visible native fields", async () => {
    const eslint = new ESLint();
    const [result] = await eslint.lintText('export const Bad = () => <input className={`text-[13px] rounded-[10px] p-[30px] ${"x"}`} />;', { filePath: "src/components/contract-probe.tsx" });
    expect(result.messages.filter(m => m.ruleId === "design/contract")).toHaveLength(4);
    const [good] = await eslint.lintText('export const Good = () => <div className="text-body rounded-xl px-3 w-[min(640px,90vw)]" />;', { filePath: "src/components/contract-probe.tsx" });
    expect(good.messages).toEqual([]);
  });
});
