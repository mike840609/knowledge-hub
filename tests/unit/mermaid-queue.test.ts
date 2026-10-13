import { describe, expect, it } from "vitest";
import { createDiagramQueue, DIAGRAM_REASONS, MAX_DIAGRAM_CHARS, MAX_DIAGRAMS, type DiagramDeps, type DiagramEngine } from "@/components/knowledge/mermaid-queue";

const svg = (body = "", box = "0 0 120.4 60") => `<svg id="x" width="100%" xmlns="http://www.w3.org/2000/svg" viewBox="${box}">${body}</svg>`;

/** The queue with everything a browser would give it replaced, and a record of what it asked for. */
function harness(render: DiagramEngine["render"] = async () => ({ svg: svg(), diagramType: "flowchart-v2" }), load?: DiagramDeps["load"]) {
  const log: string[] = [];
  let made = 0;
  let loads = 0;
  const queue = createDiagramQueue({
    load: load ?? (async () => { loads++; return { render: async (id, source) => { log.push(`render ${source}`); const out = await render(id, source); log.push(`done ${source}`); return out; } }; }),
    toUrl: (text) => { const url = `blob:${++made}`; log.push(`url ${url} ${text.length}`); return url; },
    revoke: (url) => { log.push(`revoke ${url}`); },
    pause: async () => { log.push("pause"); },
  });
  return { queue, log, loads: () => loads };
}

describe("a block that is drawn", () => {
  it("becomes a URL, with the type Mermaid names and the size its viewBox gives, rounded up", async () => {
    const { queue } = harness();
    expect(await queue.draw({}, 0, "flowchart LR\nA-->B")).toEqual({ drawn: { url: "blob:1", type: "flowchart-v2", width: 121, height: 60 } });
  });

  it("loads Mermaid once, however many blocks there are", async () => {
    const { queue, loads } = harness();
    await Promise.all([queue.draw({}, 0, "a"), queue.draw({}, 1, "b"), queue.draw({}, 2, "c")]);
    expect(loads()).toBe(1);
  });

  it("is drawn alone: one block finishes, the browser gets a turn, and then the next begins", async () => {
    const { queue, log } = harness();
    await Promise.all([queue.draw({}, 0, "a"), queue.draw({}, 1, "b")]);
    expect(log.filter((line) => !line.startsWith("url"))).toEqual(["render a", "done a", "pause", "render b", "done b", "pause"]);
  });
});

describe("a block that is not drawn says why, and is left as it was", () => {
  it("too long: not even tried", async () => {
    const { queue, log, loads } = harness();
    expect(await queue.draw({}, 0, "x".repeat(MAX_DIAGRAM_CHARS + 1))).toEqual({ reason: DIAGRAM_REASONS.long });
    expect(await queue.draw({}, 0, "x".repeat(MAX_DIAGRAM_CHARS))).toHaveProperty("drawn");
    expect(log.filter((line) => line.startsWith("render"))).toHaveLength(1);
    expect(loads()).toBe(1);
  });

  it("the 51st on the page: not even tried", async () => {
    const { queue } = harness();
    expect(await queue.draw({}, MAX_DIAGRAMS - 1, "a")).toHaveProperty("drawn");
    expect(await queue.draw({}, MAX_DIAGRAMS, "a")).toEqual({ reason: DIAGRAM_REASONS.many });
  });

  it("Mermaid cannot parse it: the first line of what it said, and no more than 200 characters of it", async () => {
    const { queue } = harness(async () => { throw new Error(`Parse error on line 2:\n...A --x\n${"-".repeat(500)}`); });
    expect(await queue.draw({}, 0, "bad")).toEqual({ reason: `${DIAGRAM_REASONS.unparsed} Parse error on line 2:` });
    const long = harness(async () => { throw new Error("e".repeat(500)); });
    const outcome = await long.queue.draw({}, 0, "bad");
    expect(outcome).toEqual({ reason: `${DIAGRAM_REASONS.unparsed} ${"e".repeat(200)}` });
  });

  it("what is thrown is not an Error: said all the same", async () => {
    const { queue } = harness(async () => { throw "plain string"; });
    expect(await queue.draw({}, 0, "bad")).toEqual({ reason: `${DIAGRAM_REASONS.unparsed} plain string` });
  });

  it.each([
    ["a foreignObject", svg("<g><foreignObject width='10' height='10'><div>x</div></foreignObject></g>")],
    ["a foreignObject in other case", svg("<FOREIGNOBJECT></FOREIGNOBJECT>")],
    ["no viewBox", "<svg xmlns='http://www.w3.org/2000/svg'></svg>"],
    ["a viewBox of no size", svg("", "0 0 0 0")],
  ])("the drawing holds %s: refused, and no URL is made of it", async (_name, text) => {
    const { queue, log } = harness(async () => ({ svg: text, diagramType: "mindmap" }));
    expect(await queue.draw({}, 0, "a")).toEqual({ reason: DIAGRAM_REASONS.unsupported });
    expect(log.some((line) => line.startsWith("url"))).toBe(false);
  });

  it("Mermaid could not be loaded: said, and tried again for the next block", async () => {
    let attempts = 0;
    const { queue } = harness(undefined, async () => {
      if (++attempts === 1) throw new Error("chunk failed");
      return { render: async () => ({ svg: svg(), diagramType: "pie" }) };
    });
    expect(await queue.draw({}, 0, "a")).toEqual({ reason: DIAGRAM_REASONS.unloaded });
    expect(await queue.draw({}, 1, "b")).toHaveProperty("drawn");
  });

  it("does not stop the blocks after it", async () => {
    const { queue } = harness(async (_id, source) => { if (source === "bad") throw new Error("no"); return { svg: svg(), diagramType: "pie" }; });
    const [first, second, third] = await Promise.all([queue.draw({}, 0, "a"), queue.draw({}, 1, "bad"), queue.draw({}, 2, "c")]);
    expect(first).toHaveProperty("drawn");
    expect(second).toHaveProperty("reason");
    expect(third).toHaveProperty("drawn");
  });
});

describe("the URLs it makes", () => {
  it("are given back when the block is drawn again", async () => {
    const { queue, log } = harness();
    const block = {};
    await queue.draw(block, 0, "a");
    await queue.draw(block, 0, "a");
    expect(log.filter((line) => /^(url|revoke)/.test(line)).map((line) => line.split(" ").slice(0, 2).join(" "))).toEqual(["url blob:1", "revoke blob:1", "url blob:2"]);
  });

  it("are given back when the block is drawn again and this time cannot be", async () => {
    let fail = false;
    const { queue, log } = harness(async () => { if (fail) throw new Error("no"); return { svg: svg(), diagramType: "pie" }; });
    const block = {};
    await queue.draw(block, 0, "a");
    fail = true;
    await queue.draw(block, 0, "a");
    expect(log).toContain("revoke blob:1");
  });

  it("are given back when the block goes", async () => {
    const { queue, log } = harness();
    const block = {};
    await queue.draw(block, 0, "a");
    queue.forget(block);
    queue.forget(block);
    expect(log.filter((line) => line.startsWith("revoke"))).toEqual(["revoke blob:1"]);
  });

  it("are not made for a block that went while it waited", async () => {
    const { queue, log } = harness();
    const block = {};
    const waiting = queue.draw(block, 0, "a");
    queue.forget(block);
    expect(await waiting).toHaveProperty("reason");
    expect(log.some((line) => line.startsWith("url"))).toBe(false);
  });

  it("are made again for a block that went and came back (React's strict mode mounts twice)", async () => {
    const { queue } = harness();
    const block = {};
    queue.forget(block);
    expect(await queue.draw(block, 0, "a")).toHaveProperty("drawn");
  });

  it("one block's are not another's", async () => {
    const { queue, log } = harness();
    const a = {}, b = {};
    await queue.draw(a, 0, "a");
    await queue.draw(b, 1, "b");
    queue.forget(a);
    expect(log.filter((line) => line.startsWith("revoke"))).toEqual(["revoke blob:1"]);
  });
});
