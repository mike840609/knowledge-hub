import { describe, expect, it } from "vitest";
import { formKeyIntent, type FormKeyEvent } from "@/lib/form-keys";

function key(overrides: Partial<FormKeyEvent> = {}): FormKeyEvent {
  return { key: "a", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, isComposing: false, keyCode: 65, ...overrides };
}

const editing = { dirty: false, busy: false, previewing: false, canPreview: true };

describe("formKeyIntent", () => {
  it("saves on ⌘Enter and Ctrl Enter", () => {
    expect(formKeyIntent(key({ key: "Enter", metaKey: true }), editing)).toBe("save");
    expect(formKeyIntent(key({ key: "Enter", ctrlKey: true }), editing)).toBe("save");
    expect(formKeyIntent(key({ key: "Enter", metaKey: true }), { ...editing, previewing: true })).toBe("save");
  });

  it("does nothing while an input method is composing", () => {
    expect(formKeyIntent(key({ key: "Enter", metaKey: true, isComposing: true }), editing)).toBeNull();
    expect(formKeyIntent(key({ key: "Escape", keyCode: 229 }), editing)).toBeNull();
  });

  it("toggles preview on ⌘⇧P and Ctrl ⇧P, whatever case the key reports", () => {
    expect(formKeyIntent(key({ key: "p", metaKey: true, shiftKey: true }), editing)).toBe("toggle-preview");
    expect(formKeyIntent(key({ key: "P", ctrlKey: true, shiftKey: true }), editing)).toBe("toggle-preview");
    expect(formKeyIntent(key({ key: "P", metaKey: true, shiftKey: true }), { ...editing, previewing: true })).toBe("toggle-preview");
  });

  it("leaves ⌘P, ⌥⌘⇧P and forms without a preview alone", () => {
    expect(formKeyIntent(key({ key: "p", metaKey: true }), editing)).toBeNull();
    expect(formKeyIntent(key({ key: "p", metaKey: true, shiftKey: true, altKey: true }), editing)).toBeNull();
    expect(formKeyIntent(key({ key: "p", metaKey: true, shiftKey: true }), { ...editing, canPreview: false })).toBeNull();
  });

  it("uses Esc in preview to return to editing, changes or not", () => {
    expect(formKeyIntent(key({ key: "Escape" }), { ...editing, previewing: true, dirty: true })).toBe("exit-preview");
  });

  it("uses Esc to leave only an unchanged, idle form", () => {
    expect(formKeyIntent(key({ key: "Escape" }), editing)).toBe("cancel");
    expect(formKeyIntent(key({ key: "Escape" }), { ...editing, dirty: true })).toBeNull();
    expect(formKeyIntent(key({ key: "Escape" }), { ...editing, busy: true })).toBeNull();
  });

  it("ignores every other key", () => {
    expect(formKeyIntent(key({ key: "e" }), editing)).toBeNull();
    expect(formKeyIntent(key({ key: "Enter" }), editing)).toBeNull();
  });
});
