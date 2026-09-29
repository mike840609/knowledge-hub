import { describe, expect, it } from "vitest";
import { formKeyIntent, type FormKeyEvent } from "@/lib/form-keys";

function key(overrides: Partial<FormKeyEvent> = {}): FormKeyEvent {
  return { key: "a", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, isComposing: false, keyCode: 65, ...overrides };
}

const editing = { dirty: false, busy: false, canToggleMode: true };

describe("formKeyIntent", () => {
  it("saves on ⌘Enter and Ctrl Enter", () => {
    expect(formKeyIntent(key({ key: "Enter", metaKey: true }), editing)).toBe("save");
    expect(formKeyIntent(key({ key: "Enter", ctrlKey: true }), editing)).toBe("save");
  });

  it("does nothing while an input method is composing", () => {
    expect(formKeyIntent(key({ key: "Enter", metaKey: true, isComposing: true }), editing)).toBeNull();
    expect(formKeyIntent(key({ key: "Escape", keyCode: 229 }), editing)).toBeNull();
    expect(formKeyIntent(key({ key: "/", metaKey: true, isComposing: true }), editing)).toBeNull();
  });

  it("toggles rendered ⇄ Markdown on ⌘/ and Ctrl /", () => {
    expect(formKeyIntent(key({ key: "/", metaKey: true }), editing)).toBe("toggle-mode");
    expect(formKeyIntent(key({ key: "/", ctrlKey: true }), editing)).toBe("toggle-mode");
    // Some layouts type "/" with Shift.
    expect(formKeyIntent(key({ key: "/", metaKey: true, shiftKey: true }), editing)).toBe("toggle-mode");
  });

  it("leaves a bare slash, ⌥⌘/ and a form without modes alone", () => {
    expect(formKeyIntent(key({ key: "/" }), editing)).toBeNull();
    expect(formKeyIntent(key({ key: "/", metaKey: true, altKey: true }), editing)).toBeNull();
    expect(formKeyIntent(key({ key: "/", metaKey: true }), { ...editing, canToggleMode: false })).toBeNull();
  });

  it("no longer answers to ⌘⇧P", () => {
    expect(formKeyIntent(key({ key: "p", metaKey: true, shiftKey: true }), editing)).toBeNull();
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
