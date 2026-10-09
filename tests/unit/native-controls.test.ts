import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A disclosure and a checkbox stay native elements and take their look from two element rules in
 * `globals.css` (design language §15). These hold the rules to the contract, and the call sites to
 * the one thing a rule cannot give them.
 */
const css = readFileSync(path.resolve("src/app/globals.css"), "utf8");

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `no rule for ${selector}`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    return statSync(file).isDirectory() ? sources(file) : file.endsWith(".tsx") ? [file] : [];
  });
}

describe("disclosure", () => {
  it("hides the platform's marker in every engine", () => {
    expect(rule("  summary")).toContain("list-none");
    expect(rule("summary::-webkit-details-marker")).toContain("display: none");
  });

  it("draws the icon set's chevron from a file and a colour token", () => {
    const marker = rule("summary::before");
    expect(marker).toContain('mask: url("/icons/chevron-right.svg")');
    expect(marker).toContain("bg-kh-text-muted");
    expect(existsSync(path.resolve("public/icons/chevron-right.svg"))).toBe(true);
  });

  it("turns the chevron when open, on the motion tokens", () => {
    expect(rule("details[open] > summary::before")).toContain("rotate(90deg)");
    expect(rule("summary::before")).toContain("duration-120");
  });

  it("gives every summary the focus ring", () => {
    const missing = sources(path.resolve("src")).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/<summary\b[^>]*>/g)]
        .filter((match) => !match[0].includes("kh-focus-ring"))
        .map(() => path.relative(process.cwd(), file)),
    );
    expect(missing).toEqual([]);
  });
});

describe("checkbox", () => {
  it("is drawn rather than left to the platform, with the control boundary and the focus idiom", () => {
    const box = rule('input[type="checkbox"]');
    expect(box).toContain("appearance-none");
    expect(box).toContain("border-kh-border-strong");
    expect(box).toContain("kh-focus-ring");
    expect(box).toContain("rounded-sm");
  });

  it("fills with the primary and checks in on-primary, both tokens", () => {
    expect(rule('input[type="checkbox"]:checked')).toContain("bg-kh-primary");
    const check = rule('input[type="checkbox"]:checked::after');
    expect(check).toContain("bg-kh-on-primary");
    expect(check).toContain('mask: url("/icons/check.svg")');
    expect(existsSync(path.resolve("public/icons/check.svg"))).toBe(true);
  });

  it("shows a disabled box as disabled", () => {
    expect(rule('input[type="checkbox"]:disabled')).toContain("opacity-50");
  });

  it("leaves no call site colouring the platform's box", () => {
    const tinted = sources(path.resolve("src")).filter((file) => readFileSync(file, "utf8").includes("accent-"));
    expect(tinted).toEqual([]);
  });

  it("draws the editor's task marker as the same box, not as a glyph", () => {
    expect(css).not.toMatch(/[☐☑]/);
    expect(rule('.kh-editor li[data-item-type="task"]::before')).toContain("border-kh-border-strong");
    expect(rule('.kh-editor li[data-item-type="task"][data-checked="true"]::before')).toContain("bg-kh-primary");
  });
});
