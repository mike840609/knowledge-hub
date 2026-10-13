/**
 * What one diagram, and one document, may cost the tab that opened it (reader-mermaid spec, "When
 * a block is not drawn"). A drawing cannot be interrupted — Mermaid needs the DOM, so it cannot
 * run in a worker — and a shared page has no sign-in in front of it.
 */
export const MAX_DIAGRAM_CHARS = 10_000;
export const MAX_DIAGRAMS = 50;

/**
 * An image cannot use a font the page loaded. Measuring in the product's and drawing in the
 * system's would clip the labels, so a diagram is measured and drawn in the system's.
 */
export const DIAGRAM_FONT = "ui-sans-serif, system-ui, sans-serif";

export const DIAGRAM_REASONS = {
  unparsed: "Could not draw this diagram:",
  long: "This diagram is too long to draw.",
  many: "Too many diagrams on this page; this one is left as code.",
  unsupported: "This kind of diagram cannot be drawn here yet.",
  unloaded: "Diagrams could not be loaded.",
};

export type Drawing = { url: string; type: string; width: number; height: number };
export type DiagramOutcome = { drawn: Drawing } | { reason: string };
export type DiagramEngine = { render(id: string, source: string): Promise<{ svg: string; diagramType: string }> };
/** What the queue needs of a browser, handed to it so that its rules can be read without one. */
export type DiagramDeps = { load(): Promise<DiagramEngine>; toUrl(svg: string): string; revoke(url: string): void; pause(): Promise<void> };

const MAX_REASON_CHARS = 200;

function said(error: unknown): string {
  return String(error instanceof Error ? error.message : error).split("\n")[0].slice(0, MAX_REASON_CHARS);
}

/** The size the drawing asks for, from its root's `viewBox`; `null` when it gives none. */
function sizeOf(svg: string): { width: number; height: number } | null {
  const box = /<svg[^>]*\sviewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(svg);
  if (!box) return null;
  const width = Math.ceil(Number(box[1])), height = Math.ceil(Number(box[2]));
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * Draws the page's diagrams one at a time, in the order they ask, and keeps the URL each one is
 * shown from. The SVG Mermaid returns goes into `toUrl` and nowhere else: it is never parsed by
 * the page. Everything it declines is an outcome with a reason, never a throw.
 */
export function createDiagramQueue(deps: DiagramDeps) {
  let engine: Promise<DiagramEngine> | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  let serial = 0;
  const urls = new Map<object, string>();
  const gone = new WeakSet<object>();

  function release(key: object) {
    const url = urls.get(key);
    if (url === undefined) return;
    urls.delete(key);
    deps.revoke(url);
  }

  async function render(source: string): Promise<{ svg: string; type: string; width: number; height: number } | { reason: string }> {
    let loaded: DiagramEngine;
    try {
      loaded = await (engine ??= deps.load());
    } catch {
      // Not kept: the next block asks again, in case it was the network.
      engine = undefined;
      return { reason: DIAGRAM_REASONS.unloaded };
    }
    let result: { svg: string; diagramType: string };
    try {
      result = await loaded.render(`kh-diagram-${++serial}`, source);
    } catch (error) {
      return { reason: `${DIAGRAM_REASONS.unparsed} ${said(error)}` };
    }
    const size = sizeOf(result.svg);
    // HTML inside an SVG draws unevenly as an image; a picture with its labels missing is worse than code.
    if (!size || /<foreignObject[\s>]/i.test(result.svg)) return { reason: DIAGRAM_REASONS.unsupported };
    return { svg: result.svg, type: result.diagramType, ...size };
  }

  async function one(key: object, source: string): Promise<DiagramOutcome> {
    const result = await render(source);
    release(key);
    if ("reason" in result) return result;
    if (gone.has(key)) return { reason: DIAGRAM_REASONS.unsupported };
    const url = deps.toUrl(result.svg);
    urls.set(key, url);
    return { drawn: { url, type: result.type, width: result.width, height: result.height } };
  }

  return {
    draw(key: object, index: number, source: string): Promise<DiagramOutcome> {
      gone.delete(key);
      if (index >= MAX_DIAGRAMS) return Promise.resolve({ reason: DIAGRAM_REASONS.many });
      if (source.length > MAX_DIAGRAM_CHARS) return Promise.resolve({ reason: DIAGRAM_REASONS.long });
      const job = tail.then(() => one(key, source));
      // `one` does not reject; the pause is the browser's turn between two drawings.
      tail = job.then(deps.pause);
      return job;
    },
    forget(key: object) {
      gone.add(key);
      release(key);
    },
  };
}
