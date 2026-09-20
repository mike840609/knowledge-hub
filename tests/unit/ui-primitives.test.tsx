import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";

/**
 * The button system has five variants, three sizes and an icon shape. Until
 * now the only thing exercising that matrix was e2e, which never asserts on
 * appearance — a variant could resolve to the wrong height or lose its focus
 * ring without anything failing.
 */
describe("buttonClasses", () => {
  it("maps each size to the height the contract names", () => {
    expect(buttonClasses({ size: "sm" })).toContain("h-6");
    expect(buttonClasses({ size: "md" })).toContain("h-8");
    expect(buttonClasses({ size: "lg" })).toContain("h-10");
  });

  it("defaults to the shell size and the primary variant", () => {
    const classes = buttonClasses();
    expect(classes).toContain("h-8");
    expect(classes).toContain("bg-kh-primary");
  });

  it("gives an icon control a square shape and no padding", () => {
    const classes = buttonClasses({ icon: true, size: "md" });
    expect(classes).toContain("h-8");
    expect(classes).toContain("w-8");
    expect(classes).not.toContain("px-3");
  });

  it("drops the fixed height for the link variant", () => {
    const classes = buttonClasses({ variant: "link" });
    expect(classes).toContain("h-auto");
    expect(classes).not.toMatch(/\bh-(6|8|10)\b/);
  });

  it("carries the one focus idiom on every variant", () => {
    for (const variant of ["primary", "secondary", "ghost", "danger", "link"] as const) {
      expect(buttonClasses({ variant })).toContain("kh-focus-ring");
    }
  });

  it("routes destructive and quiet variants to their own tokens", () => {
    expect(buttonClasses({ variant: "danger" })).toContain("bg-kh-danger-solid");
    expect(buttonClasses({ variant: "ghost" })).toContain("bg-transparent");
    expect(buttonClasses({ variant: "secondary" })).toContain("border-kh-border-strong");
  });

  it("appends the caller's classes after its own", () => {
    expect(buttonClasses({ className: "mt-6" })).toMatch(/mt-6\s*$/);
  });
});

describe("Button", () => {
  it("renders a button carrying the computed classes", () => {
    const html = renderToStaticMarkup(<Button variant="danger" size="lg">Archive</Button>);
    expect(html).toContain("<button");
    expect(html).toContain("bg-kh-danger-solid");
    expect(html).toContain("h-10");
    expect(html).toContain("Archive");
  });

  it("forwards arbitrary props to the element", () => {
    const html = renderToStaticMarkup(<Button type="submit" aria-label="Save">Save</Button>);
    expect(html).toContain('type="submit"');
    expect(html).toContain('aria-label="Save"');
  });
});

describe("Badge", () => {
  it("gives each status variant its own tone rather than a shared fill", () => {
    const tones = (["success", "warning", "danger"] as const).map(
      (variant) => renderToStaticMarkup(<Badge variant={variant}>x</Badge>),
    );
    for (const html of tones) expect(html).toContain("<span");
    // The regression this guards: all three once shared bg-kh-bg-hover and
    // differed only in text colour, so status was not scannable.
    const backgrounds = tones.map((html) => html.match(/bg-kh-\w+(-\w+)*/)?.[0]);
    expect(new Set(backgrounds).size).toBe(3);
  });

  it("defaults to the neutral tone", () => {
    expect(renderToStaticMarkup(<Badge>x</Badge>)).toContain("bg-kh-bg-hover");
  });
});
