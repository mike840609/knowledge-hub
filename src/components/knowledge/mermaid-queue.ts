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

/**
 * The diagram types that are drawn, by the id Mermaid's detector gives each. Any other type is left as code
 * before Mermaid lays anything out, because laying out is when a type could write the author's text into
 * this page as HTML (reader-mermaid spec, "What B does not cover"). A type is here only because
 * scripts/test/mermaid-assumptions.mjs, which holds a copy of this list, has laid it out in a browser with
 * hostile text and seen no element of the author's choosing: add one there first, and here when it passes.
 */
export const DRAWN_TYPES = ["flowchart-v2", "sequence", "classDiagram", "stateDiagram", "er", "gantt", "pie", "mindmap", "timeline", "quadrantChart", "gitGraph", "requirement", "c4", "sankey", "xychart", "block", "kanban", "packet", "radar", "treemap"];

export type Drawing = { url: string; type: string; width: number; height: number };
export type DiagramOutcome = { drawn: Drawing } | { reason: string };
export type DiagramEngine = {
  /**
   * What `render` would draw of this text, found by parsing it and laying nothing out. No `type` when
   * Mermaid can tell none; `error` is what its parser said of a text it could not read.
   */
  inspect(source: string): Promise<{ type?: string; error?: unknown }>;
  render(id: string, source: string): Promise<{ svg: string; diagramType: string }>;
};
/** What the queue needs of a browser, handed to it so that its rules can be read without one. */
export type DiagramDeps = {
  load(): Promise<DiagramEngine>;
  toUrl(svg: string): string;
  /** Whether the browser can show what is at `url` as an image. */
  decodes(url: string): Promise<boolean>;
  revoke(url: string): void;
  pause(): Promise<void>;
};

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

const XLINK = 'xmlns:xlink="http://www.w3.org/1999/xlink"';

/**
 * The two things Mermaid 12.2.0 writes that an image cannot read, mended; nothing else is rewritten. An image
 * is parsed as XML, and Mermaid's string is HTML's serialisation: a non-breaking space comes out as `&nbsp;`,
 * an entity XML does not know, and a link (`click A href "…"`) as `xlink:href` with the prefix undeclared,
 * since Mermaid declares it only when it is given a container. Either made the whole picture fail to load.
 */
function mended(svg: string): string {
  const spaced = svg.replaceAll("&nbsp;", "&#160;");
  const root = /<svg\b[^>]*>/.exec(spaced)?.[0] ?? "";
  return spaced.includes("xlink:") && !root.includes("xmlns:xlink=") ? spaced.replace(/<svg\b/, `<svg ${XLINK}`) : spaced;
}

/**
 * Draws the page's diagrams one at a time, in the order they ask, and keeps the URL each one is
 * shown from. The SVG Mermaid returns goes into `toUrl` and nowhere else: it is never parsed by
 * the page. Everything it declines is an outcome with a reason, never a throw. Only the newest
 * request for a block is drawn: an older one that has not begun is dropped, and one under way
 * keeps no URL, so the picture a block shows lasts until its replacement exists. A URL is kept only
 * once the browser has shown it can load it as an image: a picture that would not load is refused.
 */
export function createDiagramQueue(deps: DiagramDeps) {
  let engine: Promise<DiagramEngine> | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  let serial = 0;
  const urls = new Map<object, string>();
  const gone = new WeakSet<object>();
  const newest = new WeakMap<object, number>();

  function discard(url: string) {
    try {
      deps.revoke(url);
    } catch {
      // revoke failure does not stop the queue
    }
  }

  function release(key: object) {
    const url = urls.get(key);
    if (url === undefined) return;
    urls.delete(key);
    discard(url);
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
    // Decided here, before anything is laid out: afterwards is too late, the page has already held the layout.
    let seen: { type?: string; error?: unknown };
    try {
      seen = await loaded.inspect(source);
    } catch {
      return { reason: DIAGRAM_REASONS.unsupported };
    }
    if (!seen.type || !DRAWN_TYPES.includes(seen.type)) return { reason: DIAGRAM_REASONS.unsupported };
    if ("error" in seen) return { reason: `${DIAGRAM_REASONS.unparsed} ${said(seen.error)}` };
    let result: { svg: string; diagramType: string };
    try {
      result = await loaded.render(`kh-diagram-${++serial}`, source);
    } catch (error) {
      return { reason: `${DIAGRAM_REASONS.unparsed} ${said(error)}` };
    }
    const size = sizeOf(result.svg);
    // HTML inside an SVG draws unevenly as an image; a picture with its labels missing is worse than code.
    if (!size || !DRAWN_TYPES.includes(result.diagramType) || /<foreignObject[\s>]/i.test(result.svg)) return { reason: DIAGRAM_REASONS.unsupported };
    return { svg: result.svg, type: result.diagramType, ...size };
  }

  async function one(key: object, request: number, source: string): Promise<DiagramOutcome> {
    // Nobody is waiting for the drawing of a block that went or has been asked for again: its
    // URL, if it has one, is for whoever asked last (or `forget` has given it back).
    const wanted = () => newest.get(key) === request && !gone.has(key);
    if (!wanted()) return { reason: DIAGRAM_REASONS.unsupported };
    const result = await render(source);
    if (!wanted()) return { reason: DIAGRAM_REASONS.unsupported };
    if ("reason" in result) {
      release(key);
      return result;
    }
    let url: string | undefined;
    let loads = false;
    try {
      url = deps.toUrl(mended(result.svg));
      // An `<img>` says nothing when its source is not an image: the reader would see a broken picture over a
      // closed source. Asked here, while the block still reads as code.
      loads = await deps.decodes(url);
    } catch {
      // a URL that cannot be made, or checked, is a drawing that cannot be shown
    }
    if (url !== undefined && !(loads && wanted())) discard(url);
    if (!wanted()) return { reason: DIAGRAM_REASONS.unsupported };
    release(key);
    if (url === undefined || !loads) return { reason: DIAGRAM_REASONS.unsupported };
    urls.set(key, url);
    return { drawn: { url, type: result.type, width: result.width, height: result.height } };
  }

  return {
    draw(key: object, index: number, source: string): Promise<DiagramOutcome> {
      gone.delete(key);
      const request = (newest.get(key) ?? 0) + 1;
      newest.set(key, request);
      if (index >= MAX_DIAGRAMS) return Promise.resolve({ reason: DIAGRAM_REASONS.many });
      if (source.length > MAX_DIAGRAM_CHARS) return Promise.resolve({ reason: DIAGRAM_REASONS.long });
      const job = tail.then(() => one(key, request, source));
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

/**
 * The keys a diagram's own text (a `%%{init}%%` directive, YAML frontmatter `config:`) may not set, at any depth.
 * The first six are Mermaid's defaults. `htmlLabels` is here because a directive could otherwise turn HTML labels
 * back on, and `dompurifyConfig` so that the sanitiser below stays ours. The last six keep a diagram from choosing
 * its own style, font, theme or layout engine: `themeCSS` and the two fonts are written into the `<style>` Mermaid
 * puts in this page while it lays a drawing out, where a `url()` is fetched, and the theme is the reader's.
 * Our own `initialize` is not subject to the list, so the theme below still follows the page.
 * scripts/test/mermaid-assumptions.mjs checks each in a browser with a copy of this list, and
 * tests/unit/mermaid-assumptions-lists.test.ts fails when the two differ.
 */
const SECURE = ["secure", "securityLevel", "startOnLoad", "maxTextSize", "suppressErrorRendering", "maxEdges", "htmlLabels", "dompurifyConfig", "themeCSS", "fontFamily", "altFontFamily", "theme", "themeVariables", "layout"];

/**
 * What Mermaid's sanitiser leaves of the tags in a label: a line break, and no attribute. Its default lets
 * `<img>`, `<video>` and `<a>` through, and text holding `$$…$$` is written into the page as an HTML label
 * whatever `htmlLabels` says, so a sequence or class diagram could otherwise put such an element in this page
 * while it is laid out. With this, what is written there is text.
 */
const SANITIZER = { ALLOWED_TAGS: ["br"], ALLOWED_ATTR: [] };

const browser: DiagramDeps = {
  // `import()`, so a page with no diagram never fetches Mermaid; tests/unit/composer-bundle.test.ts holds that.
  async load() {
    const { default: mermaid } = await import("mermaid");
    // Before each drawing, not once: the theme's colours are read as they are now.
    // `strict`, no HTML labels, `secure` and the sanitiser are what guard the moment Mermaid lays a drawing out in this page.
    const configure = () => mermaid.initialize({
      startOnLoad: false, securityLevel: "strict", htmlLabels: false, suppressErrorRendering: true,
      secure: SECURE, dompurifyConfig: SANITIZER,
      theme: "base", themeVariables: themeVariables(), fontFamily: DIAGRAM_FONT,
    });
    return {
      // `parse` goes the way `render` goes as far as the type (the same frontmatter, directives, comments and
      // detectors, read in 12.2.0's `processAndSetConfigs` and `Diagram.fromText`) and stops before any layout.
      async inspect(source) {
        configure();
        try {
          return { type: (await mermaid.parse(source)).diagramType };
        } catch (error) {
          // Nothing is drawn of a text that does not parse; the type only chooses which reason is given.
          try { return { type: mermaid.detectType(source), error }; } catch { return { error }; }
        }
      },
      async render(id, source) {
        configure();
        // `bindFunctions` is not taken: nothing in a diagram may be clicked.
        const { svg, diagramType } = await mermaid.render(id, source);
        return { svg, diagramType };
      },
    };
  },
  toUrl: (svg) => URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })),
  decodes: (url) => new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image.naturalWidth > 0);
    image.onerror = () => resolve(false);
    image.src = url;
  }),
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
