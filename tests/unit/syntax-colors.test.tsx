import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { describe, expect, it } from "vitest";
import { codeHighlightPlugins } from "@/components/knowledge/code-highlight";
import { PLATFORM_SAMPLES, SCOPE_SAMPLES } from "../fixtures/code-samples";

/**
 * The colour of code (daily-driver spec §5). Two things can quietly go wrong and neither shows in a
 * type check: a colour someone changes until it cannot be read on the block's background, and a
 * class the highlighter emits that no rule colours. Both are read from the stylesheet itself, so
 * the tests cannot drift from what ships.
 */
const CSS = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");
const CSS_WITHOUT_COMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

const TOKENS = ["keyword", "string", "number", "comment", "function", "type", "variable", "meta"].map((name) => `--kh-syntax-${name}`);
/** What the diff rules borrow from the rest of the product: they sit on the same background, so they are held to the same bar. */
const BORROWED = ["--kh-success", "--kh-danger"];
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];

/** The custom properties a theme's blocks declare. Light is the plain `:root`, which has a second, unrelated block. */
function properties(theme: Theme): Record<string, string> {
  const selector = theme === "light" ? ":root" : ':root[data-theme="dark"]';
  const found: Record<string, string> = {};
  const blocks = CSS_WITHOUT_COMMENTS.matchAll(/^([^\n{}]+?)\s*\{([^{}]*)\}/gm);
  for (const [, blockSelector, body] of blocks) {
    if (blockSelector.trim() !== selector) continue;
    for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) found[name] = value.trim();
  }
  return found;
}

/** WCAG 2.x relative luminance and contrast ratio, for the six-digit hex the tokens are written in. */
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("the syntax tokens", () => {
  it.each(THEMES)("are all defined in the %s theme, as six-digit hex", (theme) => {
    const declared = properties(theme);
    for (const name of TOKENS) expect(declared[name], `${name} in ${theme}`).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("are the same eight in both themes, and no others", () => {
    for (const theme of THEMES) {
      expect(Object.keys(properties(theme)).filter((name) => name.startsWith("--kh-syntax-")).sort()).toEqual([...TOKENS].sort());
    }
  });

  // The bar the contract sets for text (§8): 4.5:1, measured where the code sits.
  describe.each(THEMES)("on the %s theme's code background", (theme) => {
    const declared = properties(theme);
    it.each([...TOKENS, ...BORROWED])("%s has at least 4.5:1 against --kh-bg-subtle", (name) => {
      expect(contrast(declared[name], declared["--kh-bg-subtle"])).toBeGreaterThanOrEqual(4.5);
    });

    it("gives every token a colour of its own, none of them the block's text colour", () => {
      const colours = TOKENS.map((name) => declared[name].toLowerCase());
      expect(new Set(colours).size).toBe(TOKENS.length);
      expect(colours).not.toContain(declared["--kh-text"].toLowerCase());
    });
  });

  it("would be caught by the bar: a colour that is too faint fails it", () => {
    // The guard is only worth having if it can fail. Light grey on the light background is the mistake it is for.
    expect(contrast("#a0a4ad", properties("light")["--kh-bg-subtle"])).toBeLessThan(4.5);
    expect(contrast("#4a5060", properties("dark")["--kh-bg-subtle"])).toBeLessThan(4.5);
  });
});

/** Every rule of the stylesheet, as its selectors and its body. */
const RULES = [...CSS_WITHOUT_COMMENTS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }));
const HLJS_RULES = RULES.filter((rule) => rule.selector.includes(".hljs-"));

describe("the rules that colour code", () => {
  it("exist", () => {
    expect(HLJS_RULES.length).toBeGreaterThan(5);
  });

  it("colour from the tokens and nothing else: no colour is written into a rule", () => {
    for (const rule of HLJS_RULES) {
      expect(rule.body, rule.selector).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
      for (const [, value] of rule.body.matchAll(/(?:^|[;\s])color\s*:\s*([^;]+)/g)) {
        expect(value.trim(), rule.selector).toMatch(/^var\((--kh-syntax-[a-z]+|--kh-success|--kh-danger)\)$/);
      }
    }
  });

  it("use every token, and only tokens that are defined", () => {
    const used = new Set(HLJS_RULES.flatMap((rule) => [...rule.body.matchAll(/var\((--[\w-]+)\)/g)].map((match) => match[1])));
    for (const name of TOKENS) expect(used.has(name), `${name} is never used`).toBe(true);
    for (const name of used) for (const theme of THEMES) expect(properties(theme)[name], `${name} in ${theme}`).toBeDefined();
  });
});

/**
 * Wrappers and punctuation: scopes that are deliberately left in the block's own colour. A wrapper
 * (`function`, `params`, `tag`, `subst`) holds other scopes and colouring it would colour them all;
 * an operator or a bracket is not worth a colour.
 */
const PLAIN_ON_PURPOSE = ["function", "class", "params", "tag", "subst", "operator", "punctuation"];

describe("the classes the highlighter emits", () => {
  const render = (language: string, code: string) =>
    renderToStaticMarkup(<ReactMarkdown rehypePlugins={codeHighlightPlugins}>{"```" + language + "\n" + code + "\n```"}</ReactMarkdown>);
  const scopesIn = (html: string) => [...html.matchAll(/class="([^"]*)"/g)].flatMap(([, value]) => value.split(" ")).filter((name) => name.startsWith("hljs-") && name !== "hljs-");
  const styled = new Set(HLJS_RULES.flatMap((rule) => [...rule.selector.matchAll(/\.hljs-([\w-]+)/g)].map((match) => match[1])));

  const samples = [...PLATFORM_SAMPLES, ...SCOPE_SAMPLES];
  const emitted = new Map<string, string>();
  for (const sample of samples) {
    for (const name of scopesIn(render(sample.language, sample.code))) {
      if (name !== "hljs") emitted.set(name.slice("hljs-".length), sample.language);
    }
  }

  it("come from samples that still produce what they were written to produce", () => {
    for (const sample of SCOPE_SAMPLES) {
      const html = render(sample.language, sample.code);
      for (const name of sample.classes) expect(html, `${sample.language} sample: ${name}`).toContain(name);
    }
  });

  it("each have a colour, or a reason not to", () => {
    const unaccounted = [...emitted].filter(([scope]) => !styled.has(scope) && !PLAIN_ON_PURPOSE.includes(scope)).map(([scope, language]) => `hljs-${scope} (in ${language})`);
    expect(unaccounted).toEqual([]);
  });

  it("are not both coloured and listed as plain: the list of what is left plain stays true", () => {
    expect(PLAIN_ON_PURPOSE.filter((scope) => styled.has(scope))).toEqual([]);
  });
});
