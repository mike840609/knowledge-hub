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
    try {
      deps.revoke(url);
    } catch {
      // revoke failure does not stop the queue
    }
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
    let url: string;
    try {
      url = deps.toUrl(result.svg);
    } catch {
      // toUrl failure prevents creating this diagram
      return { reason: DIAGRAM_REASONS.unsupported };
    }
    urls.set(key, url);
    return { drawn: { url, type: result.type, width: result.width, height: result.height } };
  }

  return {
    draw(key: object, index: number, source: string): Promise<DiagramOutcome> {
      gone.delete(key);
      if (index >= MAX_DIAGRAMS) return Promise.resolve({ reason: DIAGRAM_REASONS.many });
      if (source.length > MAX_DIAGRAM_CHARS) return Promise.resolve({ reason: DIAGRAM_REASONS.long });
      const job = tail.then(() => one(key, source));
      // `one` does not reject; pause failures are caught so they do not break the queue.
      tail = job.then(() => deps.pause()).catch(() => {});
      return job;
    },
    forget(key: object) {
      gone.add(key);
      release(key);
    },
  };
}

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Mermaid's `base` theme, given the product's tokens as they resolve now (design language §8,
 * "Diagrams in a document"). Read at each drawing, so no colour is declared here and a change of
 * theme is a redraw. The background is the page's: the image is transparent.
 */
function themeVariables() {
  const text = token("--kh-text"), line = token("--kh-text-muted"), fill = token("--kh-bg-subtle"), border = token("--kh-border-strong"), note = token("--kh-highlight");
  return {
    fontFamily: DIAGRAM_FONT, background: "transparent",
    primaryColor: fill, secondaryColor: fill, tertiaryColor: fill, mainBkg: fill,
    primaryBorderColor: border, secondaryBorderColor: border, tertiaryBorderColor: border, clusterBorder: border,
    primaryTextColor: text, secondaryTextColor: text, tertiaryTextColor: text, textColor: text, titleColor: text,
    lineColor: line,
    noteBkgColor: note, noteTextColor: text, noteBorderColor: border,
  };
}

const browser: DiagramDeps = {
  // `import()`, so a page with no diagram never fetches Mermaid; tests/unit/composer-bundle.test.ts holds that.
  async load() {
    const { default: mermaid } = await import("mermaid");
    return {
      async render(id, source) {
        // `strict`, and no HTML labels: the two things that guard the moment Mermaid lays the drawing out in this page.
        // `secure` lists the keys a diagram's own text (a `%%{init}%%` directive, YAML frontmatter) may not set. The first
        // six are Mermaid's defaults; `htmlLabels` is added because a directive or frontmatter could otherwise turn HTML
        // labels back on. scripts/test/mermaid-assumptions.mjs checks this in a browser with the same list: keep them equal.
        mermaid.initialize({
          startOnLoad: false, securityLevel: "strict", htmlLabels: false, suppressErrorRendering: true,
          secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "suppressErrorRendering", "maxEdges", "htmlLabels"],
          theme: "base", themeVariables: themeVariables(), fontFamily: DIAGRAM_FONT,
        });
        // `bindFunctions` is not taken: nothing in a diagram may be clicked.
        const { svg, diagramType } = await mermaid.render(id, source);
        return { svg, diagramType };
      },
    };
  },
  toUrl: (svg) => URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })),
  revoke: (url) => URL.revokeObjectURL(url),
  pause: () => new Promise((resolve) => setTimeout(resolve)),
};

let shared: ReturnType<typeof createDiagramQueue> | undefined;
/** The page's queue. One, so that the diagrams of one document are drawn in turn. */
export const diagrams = () => (shared ??= createDiagramQueue(browser));

const themeListeners = new Set<() => void>();
let themeObserver: MutationObserver | undefined;

/** Tells `listener` when the reader changes theme. One observer for the page, whoever asks. */
export function subscribeTheme(listener: () => void): () => void {
  themeListeners.add(listener);
  if (!themeObserver) {
    themeObserver = new MutationObserver(() => themeListeners.forEach((each) => each()));
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }
  return () => { themeListeners.delete(listener); };
}

export const readTheme = () => document.documentElement.dataset.theme ?? "";
