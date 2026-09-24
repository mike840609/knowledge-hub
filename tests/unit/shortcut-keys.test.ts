import { describe, expect, it } from "vitest";
import { isSingleKeyShortcut, shortcutLabel, type KeyEventLike } from "@/lib/shortcut-keys";

/** A target whose closest() answers for the selectors it is "inside". */
function inside(...matches: string[]) {
  return { closest: (selector: string) => (matches.some((m) => selector.includes(m)) ? {} : null) };
}

function key(overrides: Partial<KeyEventLike> = {}): KeyEventLike {
  return {
    key: "c",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    repeat: false,
    target: inside(),
    ...overrides,
  };
}

describe("isSingleKeyShortcut", () => {
  it("accepts a plain letter or slash on the page", () => {
    expect(isSingleKeyShortcut(key({ key: "c" }))).toBe(true);
    expect(isSingleKeyShortcut(key({ key: "e" }))).toBe(true);
    expect(isSingleKeyShortcut(key({ key: "/" }))).toBe(true);
  });

  it("accepts Shift+/ because some layouts need Shift to type a slash", () => {
    expect(isSingleKeyShortcut(key({ key: "/", shiftKey: true }))).toBe(true);
  });

  it("refuses a letter with Shift", () => {
    expect(isSingleKeyShortcut(key({ key: "C", shiftKey: true }))).toBe(false);
  });

  it("refuses any modifier", () => {
    expect(isSingleKeyShortcut(key({ metaKey: true }))).toBe(false);
    expect(isSingleKeyShortcut(key({ ctrlKey: true }))).toBe(false);
    expect(isSingleKeyShortcut(key({ altKey: true }))).toBe(false);
  });

  it("refuses a key that is part of an input-method composition", () => {
    expect(isSingleKeyShortcut(key({ isComposing: true }))).toBe(false);
    expect(isSingleKeyShortcut(key({ keyCode: 229 }))).toBe(false);
  });

  it("refuses an auto-repeated key", () => {
    expect(isSingleKeyShortcut(key({ repeat: true }))).toBe(false);
  });

  it("refuses a key typed into something editable", () => {
    expect(isSingleKeyShortcut(key({ target: inside("input") }))).toBe(false);
    expect(isSingleKeyShortcut(key({ target: inside("textarea") }))).toBe(false);
    expect(isSingleKeyShortcut(key({ target: inside("select") }))).toBe(false);
    expect(isSingleKeyShortcut(key({ target: inside("[contenteditable]") }))).toBe(false);
  });

  it("refuses a key pressed inside a dialog, menu or listbox", () => {
    expect(isSingleKeyShortcut(key({ target: inside('[role="dialog"]') }))).toBe(false);
    expect(isSingleKeyShortcut(key({ target: inside('[role="menu"]') }))).toBe(false);
    expect(isSingleKeyShortcut(key({ target: inside('[role="listbox"]') }))).toBe(false);
  });

  it("treats a target without closest() (the window, the document) as the page", () => {
    expect(isSingleKeyShortcut(key({ target: null }))).toBe(true);
    expect(isSingleKeyShortcut(key({ target: {} }))).toBe(true);
  });
});

describe("shortcutLabel", () => {
  it("shows a single key as itself", () => {
    expect(shortcutLabel("E")).toBe("E");
    expect(shortcutLabel("C")).toBe("C");
  });

  it("shows the first alternative, with Meta as ⌘", () => {
    expect(shortcutLabel("Meta+I Control+I")).toBe("⌘I");
    expect(shortcutLabel("Meta+K Control+K /")).toBe("⌘K");
  });

  it("shows Control as Ctrl when it comes first", () => {
    expect(shortcutLabel("Control+I")).toBe("Ctrl I");
  });
});
