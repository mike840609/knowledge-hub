import { describe, expect, it, vi } from "vitest";
import { createDiagramQueue, DIAGRAM_REASONS, DRAWN_TYPES, MAX_DIAGRAM_CHARS, MAX_DIAGRAMS, type DiagramDeps, type DiagramEngine } from "@/components/knowledge/mermaid-queue";

const svg = (body = "", box = "0 0 120.4 60") => `<svg id="x" width="100%" xmlns="http://www.w3.org/2000/svg" viewBox="${box}">${body}</svg>`;

/** The queue with everything a browser would give it replaced, and a record of what it asked for. */
function harness(
  render: DiagramEngine["render"] = async () => ({ svg: svg(), diagramType: "flowchart-v2" }),
  load?: DiagramDeps["load"],
  overrides?: { toUrl?: (text: string) => string; revoke?: (url: string) => void; pause?: () => Promise<void>; inspect?: DiagramEngine["inspect"]; decodes?: DiagramDeps["decodes"] },
) {
  const log: string[] = [];
  const texts: string[] = [];
  let made = 0;
  let loads = 0;
  const queue = createDiagramQueue({
    load: load ?? (async () => { loads++; return { inspect: overrides?.inspect ?? (async () => ({ type: "flowchart-v2" })), render: async (id, source) => { log.push(`render ${source}`); const out = await render(id, source); log.push(`done ${source}`); return out; } }; }),
    toUrl: overrides?.toUrl ?? ((text) => { const url = `blob:${++made}`; texts.push(text); log.push(`url ${url} ${text.length}`); return url; }),
    decodes: overrides?.decodes ?? (async () => true),
    revoke: overrides?.revoke ?? ((url) => { log.push(`revoke ${url}`); }),
    pause: overrides?.pause ?? (async () => { log.push("pause"); }),
  });
  return { queue, log, texts, loads: () => loads };
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
      return { inspect: async () => ({ type: "pie" }), render: async () => ({ svg: svg(), diagramType: "pie" }) };
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

  it("toUrl throws for one block: that draw resolves with unsupported, and a block after it is still drawn", async () => {
    let count = 0;
    const h = harness(undefined, undefined, {
      toUrl: () => {
        count++;
        if (count === 1) throw new Error("no blob");
        return `blob:${count}`;
      },
    });
    const [first, second] = await Promise.all([h.queue.draw({}, 0, "a"), h.queue.draw({}, 1, "b")]);
    expect(first).toEqual({ reason: DIAGRAM_REASONS.unsupported });
    expect(second).toHaveProperty("drawn");
  });

  it("revoke throws when a block is drawn again: draw still resolves to drawn, and a later block is still drawn", async () => {
    let throwOnRevoke = false;
    const h = harness(undefined, undefined, {
      revoke: (url) => {
        if (throwOnRevoke) throw new Error("revoke failed");
        h.log.push(`revoke ${url}`);
      },
    });
    const block = {};
    const first = await h.queue.draw(block, 0, "a");
    expect(first).toHaveProperty("drawn");
    throwOnRevoke = true;
    const second = await h.queue.draw(block, 0, "a");
    expect(second).toHaveProperty("drawn");
    const third = await h.queue.draw({}, 2, "c");
    expect(third).toHaveProperty("drawn");
  });

  it("pause rejects after one block: the next block is still drawn", async () => {
    let count = 0;
    const h = harness(undefined, undefined, {
      pause: async () => {
        count++;
        h.log.push("pause");
        if (count === 1) throw new Error("pause failed");
      },
    });
    const [first, second] = await Promise.all([h.queue.draw({}, 0, "a"), h.queue.draw({}, 1, "b")]);
    expect(first).toHaveProperty("drawn");
    expect(second).toHaveProperty("drawn");
  });

  it("forget does not throw when revoke throws", async () => {
    const h = harness(undefined, undefined, {
      revoke: () => {
        throw new Error("revoke failed");
      },
    });
    const block = {};
    await h.queue.draw(block, 0, "a");
    expect(() => {
      h.queue.forget(block);
    }).not.toThrow();
  });
});

describe("what is drawn is decided before Mermaid lays anything out", () => {
  /** A queue whose engine says `seen` of every block, and a count of the drawings it was then asked for. */
  function gate(seen: Awaited<ReturnType<DiagramEngine["inspect"]>> | Error, drawn = "flowchart-v2") {
    const asked: string[] = [];
    const h = harness(async () => ({ svg: svg(), diagramType: drawn }), undefined, {
      inspect: async (source) => { asked.push(`inspect ${source}`); if (seen instanceof Error) throw seen; return seen; },
    });
    const renders = () => h.log.filter((line) => line.startsWith("render"));
    return { ...h, asked, renders };
  }

  it.each(DRAWN_TYPES.map((type) => [type]))("a %s is drawn", async (type) => {
    const { queue } = gate({ type }, type);
    expect(await queue.draw({}, 0, "a")).toHaveProperty("drawn", expect.objectContaining({ type }));
  });

  it("holds the types shown to lay out without HTML, by the ids Mermaid's detectors give them", () => {
    expect(DRAWN_TYPES).toContain("flowchart-v2");
    expect(DRAWN_TYPES).toContain("sequence");
    for (const refused of ["architecture", "eventmodeling", "journey", "flowchart-elk", "error", "---"]) expect(DRAWN_TYPES).not.toContain(refused);
  });

  it.each([["architecture"], ["eventmodeling"], ["a type Mermaid gains later"]])("a type that is not on the list (%s) is refused, and Mermaid is never asked to draw it", async (type) => {
    const { queue, log, renders, asked } = gate({ type });
    expect(await queue.draw({}, 0, "a")).toEqual({ reason: DIAGRAM_REASONS.unsupported });
    expect(asked).toEqual(["inspect a"]);
    expect(renders()).toEqual([]);
    expect(log.some((line) => line.startsWith("url"))).toBe(false);
  });

  it("a text whose type cannot be told is refused, and Mermaid is never asked to draw it", async () => {
    const { queue, renders } = gate({ error: new Error("No diagram type detected matching given configuration for text: hello") });
    expect(await queue.draw({}, 0, "hello")).toEqual({ reason: DIAGRAM_REASONS.unsupported });
    expect(renders()).toEqual([]);
  });

  it("finding the type fails outright: refused, never drawn, and the block after it is still drawn", async () => {
    let first = true;
    const h = harness(undefined, undefined, { inspect: async () => { if (first) { first = false; throw new Error("no"); } return { type: "pie" }; } });
    const [bad, good] = await Promise.all([h.queue.draw({}, 0, "a"), h.queue.draw({}, 1, "b")]);
    expect(bad).toEqual({ reason: DIAGRAM_REASONS.unsupported });
    expect(good).toHaveProperty("drawn");
    expect(h.log.filter((line) => line.startsWith("render"))).toEqual(["render b"]);
  });

  it("a type on the list that does not parse says what Mermaid said, as before, without being laid out", async () => {
    const { queue, renders } = gate({ type: "flowchart-v2", error: new Error("Parse error on line 2:\n...A --x") });
    expect(await queue.draw({}, 0, "bad")).toEqual({ reason: `${DIAGRAM_REASONS.unparsed} Parse error on line 2:` });
    expect(renders()).toEqual([]);
  });

  it("a type not on the list that does not parse is refused as its type, not for its syntax", async () => {
    const { queue, renders } = gate({ type: "architecture", error: new Error("Parse error on line 2:") });
    expect(await queue.draw({}, 0, "bad")).toEqual({ reason: DIAGRAM_REASONS.unsupported });
    expect(renders()).toEqual([]);
  });

  it("the type is found first, and the drawing asked for only then", async () => {
    const order: string[] = [];
    const queue = createDiagramQueue({
      load: async () => ({
        inspect: async (source) => { order.push(`inspect ${source}`); return { type: "sequence" }; },
        render: async (_id, source) => { order.push(`render ${source}`); return { svg: svg(), diagramType: "sequence" }; },
      }),
      toUrl: () => "blob:1", decodes: async () => true, revoke: () => {}, pause: async () => {},
    });
    await Promise.all([queue.draw({}, 0, "a"), queue.draw({}, 1, "b")]);
    expect(order).toEqual(["inspect a", "render a", "inspect b", "render b"]);
  });

  it("a drawing that comes back as a type not on the list is not shown", async () => {
    const { queue, log } = gate({ type: "flowchart-v2" }, "architecture");
    expect(await queue.draw({}, 0, "a")).toEqual({ reason: DIAGRAM_REASONS.unsupported });
    expect(log.some((line) => line.startsWith("url"))).toBe(false);
  });
});

describe("a drawing the browser cannot show as an image", () => {
  it("is refused, its URL is given back, and the block after it is still drawn", async () => {
    const h = harness(undefined, undefined, { decodes: async (url) => url !== "blob:1" });
    const [broken, fine] = await Promise.all([h.queue.draw({}, 0, "a"), h.queue.draw({}, 1, "b")]);
    expect(broken).toEqual({ reason: DIAGRAM_REASONS.unsupported });
    expect(fine).toHaveProperty("drawn", expect.objectContaining({ url: "blob:2" }));
    expect(h.log.filter((line) => line.startsWith("revoke"))).toEqual(["revoke blob:1"]);
  });

  it("is refused when the check itself fails", async () => {
    const h = harness(undefined, undefined, { decodes: async () => { throw new Error("no image"); } });
    expect(await h.queue.draw({}, 0, "a")).toEqual({ reason: DIAGRAM_REASONS.unsupported });
    expect(h.log.filter((line) => line.startsWith("revoke"))).toEqual(["revoke blob:1"]);
  });

  it("gives back the picture the block showed before, as any drawing that cannot be made does", async () => {
    let good = true;
    const h = harness(undefined, undefined, { decodes: async () => good });
    const block = {};
    expect(await h.queue.draw(block, 0, "a")).toHaveProperty("drawn");
    good = false;
    expect(await h.queue.draw(block, 0, "b")).toEqual({ reason: DIAGRAM_REASONS.unsupported });
    expect(h.log.filter((line) => line.startsWith("revoke")).sort()).toEqual(["revoke blob:1", "revoke blob:2"]);
  });

  it("keeps the picture a block shows until the new one is known to load", async () => {
    let open!: (loads: boolean) => void;
    const checking = new Promise<boolean>((resolve) => { open = resolve; });
    let checks = 0;
    const h = harness(undefined, undefined, { decodes: async () => (++checks === 1 ? true : checking) });
    const block = {};
    await h.queue.draw(block, 0, "a");
    const replacing = h.queue.draw(block, 0, "b");
    await vi.waitFor(() => expect(checks).toBe(2));
    expect(h.log.filter((line) => line.startsWith("revoke"))).toEqual([]);
    open(true);
    expect(await replacing).toHaveProperty("drawn", expect.objectContaining({ url: "blob:2" }));
    expect(h.log.filter((line) => line.startsWith("revoke"))).toEqual(["revoke blob:1"]);
  });

  it("a block that went while its picture was being checked keeps no URL", async () => {
    let open!: (loads: boolean) => void;
    const checking = new Promise<boolean>((resolve) => { open = resolve; });
    let checks = 0;
    const h = harness(undefined, undefined, { decodes: async () => { checks++; return checking; } });
    const block = {};
    const waiting = h.queue.draw(block, 0, "a");
    await vi.waitFor(() => expect(checks).toBe(1));
    h.queue.forget(block);
    open(true);
    expect(await waiting).toHaveProperty("reason");
    expect(h.log.filter((line) => line.startsWith("revoke"))).toEqual(["revoke blob:1"]);
  });
});

describe("the two things Mermaid writes that an image cannot read are mended, and nothing else is touched", () => {
  const XLINK = 'xmlns:xlink="http://www.w3.org/1999/xlink"';
  const drawnAs = async (text: string) => {
    const h = harness(async () => ({ svg: text, diagramType: "flowchart-v2" }));
    expect(await h.queue.draw({}, 0, "a")).toHaveProperty("drawn");
    return h.texts[0];
  };

  it("a non-breaking space written as an HTML entity becomes a number XML knows", async () => {
    expect(await drawnAs(svg("<text>a&nbsp;b&nbsp;c</text>"))).toBe(svg("<text>a&#160;b&#160;c</text>"));
  });

  it("a link's `xlink:` prefix is declared on the root when the root does not declare it", async () => {
    const linked = svg('<a xlink:href="https://example.com/x"><rect/></a><svg><a xlink:href="#y"/></svg>');
    const mended = await drawnAs(linked);
    expect(mended).toBe(linked.replace("<svg ", `<svg ${XLINK} `));
    expect(mended.split(XLINK)).toHaveLength(2);
  });

  it("a root that declares the prefix already is left as it is", async () => {
    const declared = svg('<a xlink:href="#y"/>').replace("<svg ", `<svg ${XLINK} `);
    expect(await drawnAs(declared)).toBe(declared);
  });

  it("a drawing with neither is the string Mermaid returned", async () => {
    const plain = svg('<text>a &amp;nbsp; b &#160; &lt;xlink&gt;</text><a href="#y"/>');
    expect(await drawnAs(plain)).toBe(plain);
  });
});

describe("the URLs it makes", () => {
  it("are given back when the block is drawn again", async () => {
    const { queue, log } = harness();
    const block = {};
    await queue.draw(block, 0, "a");
    await queue.draw(block, 0, "a");
    // The old one goes once the new one is known to load, not before: the picture on show is never a dead URL.
    expect(log.filter((line) => /^(url|revoke)/.test(line)).map((line) => line.split(" ").slice(0, 2).join(" "))).toEqual(["url blob:1", "url blob:2", "revoke blob:1"]);
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

  it.each([
    ["has grown too long to draw", 0, "x".repeat(MAX_DIAGRAM_CHARS + 1), DIAGRAM_REASONS.long],
    ["is now past the last diagram a page draws", MAX_DIAGRAMS, "a", DIAGRAM_REASONS.many],
  ])("are given back when a block that was drawn %s", async (_name, index, source, reason) => {
    const { queue, log } = harness();
    const block = {};
    expect(await queue.draw(block, 0, "a")).toHaveProperty("drawn");
    expect(await queue.draw(block, index, source)).toEqual({ reason });
    expect(log.filter((line) => line.startsWith("revoke"))).toEqual(["revoke blob:1"]);
    // Once: there is nothing left to give back when the block goes.
    queue.forget(block);
    expect(log.filter((line) => line.startsWith("revoke"))).toEqual(["revoke blob:1"]);
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

/** A render that holds `slow` open until the test lets it finish; `started` settles once Mermaid has been asked for it. */
function gated(slow: string) {
  let open!: () => void, begin!: () => void;
  const opened = new Promise<void>((resolve) => { open = resolve; });
  const started = new Promise<void>((resolve) => { begin = resolve; });
  const render: DiagramEngine["render"] = async (_id, source) => {
    if (source === slow) { begin(); await opened; }
    return { svg: svg(), diagramType: "pie" };
  };
  return { render, started, open };
}

describe("a drawing nobody is waiting for is not made", () => {
  it("the same block asked twice before the first is drawn: Mermaid is asked once, for the later; the earlier still answers", async () => {
    const { queue, log } = harness();
    const block = {};
    const [earlier, later] = await Promise.all([queue.draw(block, 0, "old"), queue.draw(block, 0, "new")]);
    expect(log.filter((line) => line.startsWith("render"))).toEqual(["render new"]);
    expect(later).toHaveProperty("drawn");
    expect(earlier).toEqual({ reason: DIAGRAM_REASONS.unsupported });
  });

  it("the same block asked three times in a row: Mermaid is asked once", async () => {
    const { queue, log } = harness();
    const block = {};
    const [first, second, third] = await Promise.all([queue.draw(block, 0, "a"), queue.draw(block, 0, "b"), queue.draw(block, 0, "c")]);
    expect(log.filter((line) => line.startsWith("render"))).toEqual(["render c"]);
    expect([first, second]).toEqual([{ reason: DIAGRAM_REASONS.unsupported }, { reason: DIAGRAM_REASONS.unsupported }]);
    expect(third).toHaveProperty("drawn");
  });

  it("the block already shows a picture: a request that is not drawn leaves it be, and the one that replaces it gives it back", async () => {
    const { queue, log } = harness();
    const block = {};
    expect(await queue.draw(block, 0, "a")).toHaveProperty("drawn");
    const [superseded, replacing] = await Promise.all([queue.draw(block, 0, "a"), queue.draw(block, 0, "a")]);
    expect(superseded).toHaveProperty("reason");
    expect(replacing).toHaveProperty("drawn", expect.objectContaining({ url: "blob:2" }));
    expect(log.filter((line) => /^(url|revoke)/.test(line)).map((line) => line.split(" ").slice(0, 2).join(" "))).toEqual(["url blob:1", "url blob:2", "revoke blob:1"]);
  });

  it("the picture a block shows is not given back while its replacement is still being made", async () => {
    const gate = gated("slow");
    const { queue, log } = harness(gate.render);
    const block = {};
    expect(await queue.draw(block, 0, "fast")).toHaveProperty("drawn");
    const replacing = queue.draw(block, 0, "slow");
    await gate.started;
    expect(log.filter((line) => line.startsWith("revoke"))).toEqual([]);
    gate.open();
    expect(await replacing).toHaveProperty("drawn");
    expect(log.filter((line) => line.startsWith("revoke"))).toEqual(["revoke blob:1"]);
  });

  it("a block that went while it waited behind another: Mermaid is never asked for it", async () => {
    const gate = gated("first");
    const { queue, log } = harness(gate.render);
    const first = queue.draw({}, 0, "first");
    const gone = {};
    const waiting = queue.draw(gone, 1, "second");
    await gate.started;
    queue.forget(gone);
    gate.open();
    expect(await first).toHaveProperty("drawn");
    expect(await waiting).toEqual({ reason: DIAGRAM_REASONS.unsupported });
    expect(log.filter((line) => line.startsWith("render"))).toEqual(["render first"]);
  });

  it("a block asked again while its own drawing is under way: the first makes no URL, the second is drawn, and one URL is made in all", async () => {
    const gate = gated("first");
    const { queue, log } = harness(gate.render);
    const block = {};
    const earlier = queue.draw(block, 0, "first");
    await gate.started;
    const later = queue.draw(block, 0, "second");
    gate.open();
    expect(await earlier).toEqual({ reason: DIAGRAM_REASONS.unsupported });
    expect(await later).toHaveProperty("drawn");
    expect(log.filter((line) => line.startsWith("url"))).toHaveLength(1);
    expect(log.filter((line) => line.startsWith("revoke"))).toEqual([]);
  });

  it("two different blocks asked back to back are both drawn: superseding is per block", async () => {
    const { queue, log } = harness();
    const [a, b] = await Promise.all([queue.draw({}, 0, "a"), queue.draw({}, 1, "b")]);
    expect(a).toHaveProperty("drawn");
    expect(b).toHaveProperty("drawn");
    expect(log.filter((line) => line.startsWith("render"))).toEqual(["render a", "render b"]);
  });

  it("a block drawn, and then asked again once that is done: drawn again, not superseded by its own finished request", async () => {
    const { queue, log } = harness();
    const block = {};
    expect(await queue.draw(block, 0, "a")).toHaveProperty("drawn");
    expect(await queue.draw(block, 0, "a")).toHaveProperty("drawn");
    expect(log.filter((line) => line.startsWith("render"))).toEqual(["render a", "render a"]);
  });

  it("a block that went and came back before it was drawn (strict mode): Mermaid is asked once", async () => {
    const { queue, log } = harness();
    const block = {};
    const first = queue.draw(block, 0, "a");
    queue.forget(block);
    const second = queue.draw(block, 0, "a");
    expect(await first).toHaveProperty("reason");
    expect(await second).toHaveProperty("drawn");
    expect(log.filter((line) => line.startsWith("render"))).toEqual(["render a"]);
  });

  it("a block that went while its drawing was under way: no URL is made, and the one it had was given back when it went", async () => {
    const gate = gated("slow");
    const { queue, log } = harness(gate.render);
    const block = {};
    await queue.draw(block, 0, "fast");
    const under = queue.draw(block, 0, "slow");
    await gate.started;
    queue.forget(block);
    gate.open();
    expect(await under).toHaveProperty("reason");
    expect(log.filter((line) => line.startsWith("url"))).toEqual([expect.stringMatching(/^url blob:1 /)]);
    expect(log.filter((line) => line.startsWith("revoke"))).toEqual(["revoke blob:1"]);
  });
});
