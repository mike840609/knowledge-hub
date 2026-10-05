import { describe, expect, it } from "vitest";
import { actionForKey, isSingleKeyShortcut, matchesShortcut, shortcutLabel, type KeyEventLike, type ShortcutEventLike } from "@/lib/shortcut-keys";

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

describe("matchesShortcut", () => {
  const press = (overrides: Partial<ShortcutEventLike> = {}): ShortcutEventLike => ({
    key: "\\",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    repeat: false,
    ...overrides,
  });
  const NAV = "Meta+\\ Control+\\";

  it("takes either alternative: ⌘ on a Mac, Ctrl elsewhere", () => {
    expect(matchesShortcut(press({ metaKey: true }), NAV)).toBe(true);
    expect(matchesShortcut(press({ ctrlKey: true }), NAV)).toBe(true);
  });

  it("wants the modifier the shortcut names, and only it", () => {
    expect(matchesShortcut(press(), NAV)).toBe(false);
    expect(matchesShortcut(press({ metaKey: true, ctrlKey: true }), NAV)).toBe(false);
    expect(matchesShortcut(press({ metaKey: true, altKey: true }), NAV)).toBe(false);
    // ⌘⇧\ types `|`, and is another shortcut.
    expect(matchesShortcut(press({ metaKey: true, shiftKey: true, key: "|" }), NAV)).toBe(false);
    expect(matchesShortcut(press({ metaKey: true, shiftKey: true }), NAV)).toBe(false);
  });

  it("wants the key it names", () => {
    expect(matchesShortcut(press({ metaKey: true, key: "/" }), NAV)).toBe(false);
    expect(matchesShortcut(press({ metaKey: true, key: "b" }), NAV)).toBe(false);
  });

  it("compares letters without regard to case, as ⌘I is bound", () => {
    expect(matchesShortcut(press({ metaKey: true, key: "I" }), "Meta+I Control+I")).toBe(true);
    expect(matchesShortcut(press({ ctrlKey: true, key: "i" }), "Meta+I Control+I")).toBe(true);
    expect(matchesShortcut(press({ ctrlKey: true, altKey: true, key: "i" }), "Meta+I Control+I")).toBe(false);
  });

  it("is not a key pressed to compose with an input method, or held down", () => {
    expect(matchesShortcut(press({ metaKey: true, isComposing: true }), NAV)).toBe(false);
    expect(matchesShortcut(press({ metaKey: true, keyCode: 229 }), NAV)).toBe(false);
    expect(matchesShortcut(press({ metaKey: true, repeat: true }), NAV)).toBe(false);
  });

  it("is not a single key: a shortcut with no modifier is isSingleKeyShortcut's, with its rules about fields", () => {
    expect(matchesShortcut(press({ key: "c" }), "C")).toBe(false);
  });
});

describe("actionForKey", () => {
  type Fixture = { id: string; shortcut?: string };

  const edit: Fixture = { id: "document.edit", shortcut: "E" };
  const move: Fixture = { id: "document.move", shortcut: "M" };
  const details: Fixture = { id: "document.details", shortcut: "Meta+I Control+I" };
  const plain: Fixture = { id: "document.copy-link" };
  const actions = [plain, edit, details, move];

  it("finds the action whose single-key shortcut is the key", () => {
    expect(actionForKey(actions, { key: "e" })).toBe(edit);
    expect(actionForKey(actions, { key: "m" })).toBe(move);
  });

  it("compares by what the key types, so a capital is the same key", () => {
    expect(actionForKey(actions, { key: "E" })).toBe(edit);
  });

  it("never matches a shortcut that carries a modifier, or an action with none", () => {
    expect(actionForKey(actions, { key: "i" })).toBeUndefined();
    expect(actionForKey([plain], { key: "e" })).toBeUndefined();
  });

  it("returns nothing for a key no action takes, and for an empty list", () => {
    expect(actionForKey(actions, { key: "z" })).toBeUndefined();
    expect(actionForKey([], { key: "e" })).toBeUndefined();
  });
});
