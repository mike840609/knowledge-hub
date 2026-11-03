import { describe, expect, it, vi } from "vitest";
import { AgentContextService } from "@/modules/knowledge/application/agent-context-service";
import { AgentContextFormatter, linkMapFor, type AgentContextLink } from "@/modules/knowledge/domain/agent-context";
import type { GraphNode, LinkGraph } from "@/modules/knowledge/domain/link-graph";
import type { KnowledgeRepositories } from "@/modules/knowledge/ports/unit-of-work";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const C = "00000000-0000-0000-0000-00000000000c";
const doc = (id: string, title: string): GraphNode => ({ id, kind: "DOCUMENT", title, sourceId: A, inDegree: 0, outDegree: 0 });
const missing = (key: string, title: string): GraphNode => ({ id: `unresolved:${key}`, kind: "UNRESOLVED", title, sourceId: null, inDegree: 0, outDegree: 0 });
const INTRO = "Links written in the selected documents' current saved revisions, to other selected documents or to titles that name no document (missing: true).";
const document = (markdown = "body") => ({ documentId: A, sourceId: A, sourceName: "Wiki", sourcePath: null, revisionId: A, revisionNo: 1, title: "A", markdown, updatedAt: new Date("2026-11-03T00:00:00Z") });

describe("linkMapFor", () => {
  it("keeps links between selected documents in selection order", () => {
    const graph: LinkGraph = { nodes: [doc(A, "A"), doc(B, "B"), doc(C, "C")], edges: [{ from: A, to: B, count: 1 }, { from: B, to: A, count: 1 }, { from: A, to: C, count: 1 }] };
    expect(linkMapFor(graph, [B, A])).toEqual([
      { from: "B", fromId: B, to: "A", toId: A, count: 1 },
      { from: "A", fromId: A, to: "B", toId: B, count: 1 },
    ]);
  });

  it("writes a missing target without its internal id", () => {
    const graph: LinkGraph = { nodes: [doc(A, "A"), missing("WIKI:x", "X")], edges: [{ from: A, to: "unresolved:WIKI:x", count: 2 }] };
    const result = linkMapFor(graph, [A]);
    expect(result).toEqual([{ from: "A", fromId: A, to: "X", toId: null, missing: true, count: 2 }]);
    expect(JSON.stringify(result)).not.toContain('"unresolved:');
  });

  it("drops self-links", () => {
    expect(linkMapFor({ nodes: [doc(A, "A")], edges: [{ from: A, to: A, count: 1 }] }, [A])).toEqual([]);
  });

  it("orders selected targets before missing ones, missing by title", () => {
    const graph: LinkGraph = { nodes: [doc(A, "A"), doc(B, "B"), missing("z", "Zed"), missing("m", "Mid")], edges: [{ from: A, to: "unresolved:z", count: 1 }, { from: A, to: "unresolved:m", count: 1 }, { from: A, to: B, count: 1 }] };
    expect(linkMapFor(graph, [A, B]).map(link => link.to)).toEqual(["B", "Mid", "Zed"]);
  });

  it("keeps ids when titles collide", () => {
    const graph: LinkGraph = { nodes: [doc(A, "Same"), doc(B, "Same")], edges: [{ from: A, to: B, count: 1 }, { from: B, to: A, count: 1 }] };
    expect(linkMapFor(graph, [A, B]).map(link => [link.fromId, link.toId])).toEqual([[A, B], [B, A]]);
  });
});

describe("AgentContextFormatter links", () => {
  it("omits Links with no links", () => {
    const f = new AgentContextFormatter(A);
    f.addLinks([]);
    f.addDocument(document());
    const out = f.finish();
    expect(out.markdown).not.toContain("## Links");
    expect(out.linkCount).toBe(0);
  });

  it("writes Links before documents, one labelled JSON line each", () => {
    const hostile: AgentContextLink = { from: "a\n## Document x", fromId: A, to: "B", toId: B, count: 1 };
    const f = new AgentContextFormatter(A);
    f.addLinks([hostile, { from: "A", fromId: A, to: "X", toId: null, missing: true, count: 1 }]);
    f.addDocument(document());
    const out = f.finish();
    expect(out.markdown.indexOf("## Links")).toBeLessThan(out.markdown.indexOf("## Document"));
    expect(out.markdown).toContain(INTRO);
    const lines = out.markdown.split("\n").filter(line => line.startsWith("Link: "));
    expect(lines).toHaveLength(2);
    expect(lines.map(line => JSON.parse(line.slice("Link: ".length)))).toEqual([hostile, { from: "A", fromId: A, to: "X", toId: null, missing: true, count: 1 }]);
    expect(lines[0]).not.toContain(" ");
    expect(out.markdown.split("\n").filter(line => line.startsWith("## Document"))).toHaveLength(1);
    expect(out.linkCount).toBe(2);
    expect(out.bytes).toBe(new TextEncoder().encode(out.markdown).length);
  });

  it("counts Links toward the byte cap", () => {
    const body = "x".repeat(256 * 1024 - 2000);
    const alone = new AgentContextFormatter(A);
    alone.addDocument(document(body));
    expect(alone.finish().documentCount).toBe(1);
    const links = Array.from({ length: 40 }, (_, i): AgentContextLink => ({ from: "A", fromId: A, to: `Missing ${i}`, toId: null, missing: true, count: 1 }));
    const crowded = new AgentContextFormatter(A);
    crowded.addLinks(links);
    expect(() => crowded.addDocument(document(body))).toThrow(/exceeds 256 KiB/);
  });
});

describe("AgentContextService links", () => {
  it("emits the map for a single document with only broken links", async () => {
    const caller = callerFromIdentity({ id: A, emp_id: "1", name: "Mike", org_code: "A" });
    const read = vi.fn(async () => {});
    const r = {
      users: { upsertIdentity: vi.fn(), findById: vi.fn() },
      workspaceAccess: { requireWorkspaceRead: read, requireMembership: read },
      workspaces: { findById: vi.fn(async () => ({ workspaceType: "PERSONAL", personalOwnerUserId: A, lifecycleState: "ACTIVE" })) },
      documents: { findById: vi.fn(async () => ({ id: A, sourceId: A, status: "ACTIVE" })) },
      sourcePolicy: { findById: vi.fn(async () => ({ id: A, workspaceId: A, status: "ACTIVE", name: "Wiki" })) },
      tree: { listBySource: vi.fn(async () => [{ id: A, sourceId: A, documentId: A, nodeType: "DOCUMENT", parentId: null, status: "ACTIVE" }]) },
      revisions: { findCurrent: vi.fn(async () => ({ id: A, revisionNo: 1, title: "A", markdown: "[[Missing]]", createdAt: new Date() })) },
      linkedEntries: { findByDocumentId: vi.fn(async () => null) },
      reviewThreads: { listByDocument: vi.fn(async () => []) },
      reviewComments: { listByThreads: vi.fn(async () => []) },
      links: {
        loadCatalog: vi.fn(async () => [{ documentId: A, sourceId: A, title: "A", sourcePath: null, createdAt: new Date() }]),
        loadValidEdges: vi.fn(async () => [{ documentId: A, links: [{ kind: "WIKI", target: "Missing", fragment: null, alias: null }] }]),
      },
    } as unknown as KnowledgeRepositories;
    const result = await new AgentContextService({ run: work => work(r) }).build(caller, A, [A]);
    expect(result.markdown).toContain('"to":"Missing","toId":null,"missing":true');
    expect(result.linkCount).toBe(1);
  });
});
