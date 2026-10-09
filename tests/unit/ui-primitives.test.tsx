import { describe, expect, it } from "vitest";
import { dialogBackdropClasses, dialogPopupClasses, dialogSurfaceClasses } from "@/components/ui/dialog";
import { renderToStaticMarkup } from "react-dom/server";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { controlHeight } from "@/components/ui/control";
import { fieldClasses } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SelectMenu } from "@/components/ui/select-menu";
import { menuPopupClasses, menuRowClasses } from "@/components/ui/menu";
import { Textarea } from "@/components/ui/textarea";
import { selectableTabClasses, tabClasses, tabListClasses } from "@/components/ui/tab";

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

/**
 * Fields drifted off the button ladder because the two spelled their heights
 * separately: `min-h-10` here, `h-10` there, and a 44px input in the search
 * form that matched neither. These lock them to the one ladder.
 */
describe("fieldClasses", () => {
  it("reads the same height ladder buttons do", () => {
    for (const size of ["sm", "md", "lg"] as const) {
      expect(fieldClasses({ size })).toContain(controlHeight[size]);
      expect(buttonClasses({ size })).toContain(controlHeight[size]);
    }
  });

  it("puts every field on the control border, not the decorative one", () => {
    // WCAG 1.4.11: a field fills with the canvas colour, so its border is the
    // only thing identifying the control and needs 3:1.
    expect(fieldClasses()).toContain("border-kh-border-strong");
    expect(fieldClasses()).not.toContain("border-kh-border ");
  });

  it("carries the one focus idiom", () => {
    expect(fieldClasses()).toContain("kh-focus-ring");
  });

  it("drops the fixed height for a multi-line field, which sizes by rows", () => {
    const classes = fieldClasses({ multiline: true });
    expect(classes).not.toMatch(/\bh-(6|8|10)\b/);
    expect(classes).toMatch(/\bpy-[\d.]+\b/);
  });
});

describe("field elements", () => {
  it("renders Input, Select and Textarea on the shared shape", () => {
    const input = renderToStaticMarkup(<Input aria-label="Query" />);
    const select = renderToStaticMarkup(<Select aria-label="Scope"><option>a</option></Select>);
    const textarea = renderToStaticMarkup(<Textarea aria-label="Body" />);
    for (const html of [input, select, textarea]) {
      expect(html).toContain("border-kh-border-strong");
      expect(html).toContain("kh-focus-ring");
    }
    expect(input).toContain("<input");
    expect(select).toContain("<select");
    expect(textarea).toContain("<textarea");
  });

  it("defaults to the same rung a default button takes", () => {
    // Every form in the app paired a default <Button> with a default <Input>
    // and got 32px next to 40px. The defaults have to agree.
    for (const html of [
      renderToStaticMarkup(<Input aria-label="Query" />),
      renderToStaticMarkup(<Select aria-label="Scope" />),
    ]) {
      expect(html).toContain(controlHeight.md);
    }
    expect(buttonClasses()).toContain(controlHeight.md);
  });

  it("still opts a whole row up a rung when asked", () => {
    expect(renderToStaticMarkup(<Input aria-label="Query" size="lg" />)).toContain(controlHeight.lg);
    expect(buttonClasses({ size: "lg" })).toContain(controlHeight.lg);
  });

  it("does not leak the ladder rung as the native size attribute", () => {
    // `size` is the ladder rung here, so the DOM attribute of the same name
    // must not leak through as a row count.
    expect(renderToStaticMarkup(<Select aria-label="Scope" size="sm" />)).not.toContain('size="');
  });
});

/**
 * Two things need the tab look and cannot share a component: Base UI's tabs
 * swap panels inside a page and mark the current one with an attribute, while
 * route tabs are links whose current one comes from the pathname. These pin
 * that they still share the shape.
 */
describe("tabClasses", () => {
  it("gives the link and attribute forms the same base", () => {
    const shared = ["-mb-px", "border-b-2", "px-3", "py-2", "text-body-sm", "font-medium"];
    for (const token of shared) {
      expect(tabClasses(false)).toContain(token);
      expect(selectableTabClasses).toContain(token);
    }
  });

  it("marks the active tab with the accent border and selected text", () => {
    expect(tabClasses(true)).toContain("border-kh-primary");
    expect(tabClasses(true)).toContain("text-kh-selected-text");
    expect(tabClasses(true)).not.toContain("border-transparent");
  });

  it("leaves an inactive tab muted and borderless", () => {
    expect(tabClasses(false)).toContain("border-transparent");
    expect(tabClasses(false)).toContain("text-kh-text-muted");
    expect(tabClasses(false)).not.toContain("border-kh-primary");
  });

  it("carries the one focus idiom rather than spelling the ring out", () => {
    // The Base UI tab used to write `focus:outline-none focus-visible:ring-2
    // focus-visible:ring-kh-focus` by hand, which is §10's "second spelling".
    expect(tabClasses(false)).toContain("kh-focus-ring");
    expect(selectableTabClasses).toContain("kh-focus-ring");
    expect(tabClasses(false)).not.toContain("focus-visible:ring-2");
  });

  it("puts the list on a single bottom rule", () => {
    expect(tabListClasses).toContain("border-b");
    expect(tabListClasses).toContain("border-kh-border");
  });
});

describe("Kbd", () => {
  it("renders a kbd on the inline-chrome radius, with the caller's classes after its own", () => {
    const html = renderToStaticMarkup(<Kbd className="ml-3">⌘K</Kbd>);
    expect(html).toMatch(/^<kbd class="[^"]*\brounded-sm\b[^"]*\bml-3"/);
    expect(html).toContain(">⌘K</kbd>");
    expect(html).not.toContain("rounded-md");
  });
});

describe("button states", () => {
  it("keeps a menu trigger lit while its menu is open", () => {
    for (const variant of ["ghost", "secondary"] as const) {
      expect(buttonClasses({ variant })).toContain("data-[popup-open]:bg-kh-bg-hover");
    }
  });

  it("answers a press on the neutral variants with the step above hover", () => {
    for (const variant of ["ghost", "secondary"] as const) {
      expect(buttonClasses({ variant })).toContain("active:bg-kh-bg-hover-strong");
    }
  });

  it("gives every filled or tinted variant a hover that differs from rest", () => {
    for (const variant of ["primary", "secondary", "ghost", "soft", "danger"] as const) {
      const classes = buttonClasses({ variant }).split(/\s+/);
      const rest = classes.find((name) => name.startsWith("bg-"));
      const hover = classes.find((name) => name.startsWith("hover:bg-"));
      expect(hover).toBeDefined();
      expect(hover).not.toBe(`hover:${rest}`);
    }
  });
});

describe("dialog surface", () => {
  it("is the modal surface: xl radius and modal elevation, and nothing else decides them", () => {
    for (const classes of [dialogSurfaceClasses, dialogPopupClasses("w-[min(26rem,92vw)]")]) {
      expect(classes).toContain("rounded-xl");
      expect(classes).toContain("shadow-modal");
      expect(classes).toContain("outline-none");
    }
  });

  it("centres a dialog and keeps the caller's width", () => {
    const classes = dialogPopupClasses("w-[min(26rem,92vw)]");
    expect(classes).toContain("top-1/2");
    expect(classes).toContain("w-[min(26rem,92vw)]");
  });

  it("lets the palette name its own backdrop layer", () => {
    expect(dialogBackdropClasses()).toContain("z-40");
    expect(dialogBackdropClasses("z-50")).not.toContain("z-40");
  });
});

describe("SelectMenu", () => {
  const options = [{ value: "name", label: "Name" }, { value: "recent", label: "Last successful sync" }];
  const html = renderToStaticMarkup(
    <SelectMenu aria-label="Sort sources" value="recent" onValueChange={() => {}} options={options} />,
  );

  it("is a field while closed: the shared shape, boundary, height and focus idiom", () => {
    expect(html).toContain("border-kh-border-strong");
    expect(html).toContain("kh-focus-ring");
    expect(html).toContain(controlHeight.md);
    expect(html).toContain("rounded-md");
  });

  it("is not the native element, and names itself", () => {
    expect(html).not.toContain("<select");
    expect(html).toContain('aria-label="Sort sources"');
  });

  it("shows the label of what is chosen and carries its value", () => {
    expect(html).toContain("Last successful sync");
    expect(html).toContain('data-value="recent"');
  });

  it("keeps a disabled field disabled", () => {
    const disabled = renderToStaticMarkup(
      <SelectMenu aria-label="Sort sources" value="name" disabled onValueChange={() => {}} options={options} />,
    );
    expect(disabled).toMatch(/disabled|data-disabled/);
  });

  it("opens as a menu: the popup and rows are the menu's own", () => {
    expect(menuPopupClasses).toContain("rounded-lg");
    expect(menuPopupClasses).toContain("shadow-popover");
    expect(menuRowClasses).toContain("min-h-8");
  });

  it("shows a row's focus as its fill alone, with no ring and no browser outline", () => {
    expect(menuRowClasses).toContain("data-[highlighted]:bg-kh-bg-hover");
    expect(menuRowClasses).toContain("outline-none");
    expect(menuRowClasses).not.toContain("kh-focus-ring");
  });
});

describe("field states and labels", () => {
  it("marks an invalid field on its border, in the danger token, and only when it is invalid", () => {
    expect(fieldClasses()).toContain("aria-[invalid=true]:border-kh-danger");
    expect(fieldClasses({ multiline: true })).toContain("aria-[invalid=true]:border-kh-danger");
  });

  it("keeps what is typed at regular weight inside a medium label", () => {
    expect(fieldClasses()).toContain("font-normal");
  });

  it("sets a multi-line field in the interface face unless the caller asks for code", () => {
    expect(renderToStaticMarkup(<Textarea aria-label="Notes" />)).not.toContain("font-mono");
    expect(renderToStaticMarkup(<Textarea aria-label="Paths" className="font-mono" />)).toContain("font-mono");
  });

  it("names a field above it: one step under body, medium, secondary", () => {
    const html = renderToStaticMarkup(<Label htmlFor="name">Name</Label>);
    expect(html).toMatch(/^<label class="block text-body-sm font-medium text-kh-text-secondary\s*" for="name">Name<\/label>$/);
  });

  it("captions a control beside it: caption size, muted, on one line", () => {
    const html = renderToStaticMarkup(<Label inline>Sort sources</Label>);
    expect(html).toContain("inline-flex items-center gap-2 text-caption text-kh-text-muted");
    expect(html).not.toContain("font-medium");
  });

  it("keeps the caller's layout classes", () => {
    expect(renderToStaticMarkup(<Label className="min-w-0 flex-1">Label</Label>)).toContain("min-w-0 flex-1");
  });
});
