// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { bufferTyping, isBuffering, isNewNoteHref, plainClick, setTyped, takeTyped } from "@/components/knowledge/typing-ahead";

// 2026-11-19 creation-flow spec, decision 3: keys typed while a new note is being made.
const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};
afterEach(() => { takeTyped(); document.body.innerHTML = ""; });

describe("typing ahead of a new note", () => {
  it("stops keeping keys at Enter in the title field: what follows is not the title", () => {
    bufferTyping("Plan");
    setTyped("Plan", true);
    for (const key of "body") press(key);
    expect(isBuffering()).toBe(false);
    expect(takeTyped()).toEqual({ text: "Plan", entered: true });
  });

  it("forgets what was kept when nothing takes it within ten seconds", () => {
    vi.useFakeTimers();
    try {
      bufferTyping();
      press("a"); press("b");
      vi.advanceTimersByTime(10_001);
      expect(isBuffering()).toBe(false);
      expect(takeTyped()).toEqual({ text: "", entered: false });
    } finally { vi.useRealTimers(); }
  });

  it("leaves keys typed into any editable element alone", () => {
    bufferTyping();
    const editable = document.body.appendChild(document.createElement("div"));
    editable.contentEditable = "plaintext-only";
    Object.defineProperty(editable, "isContentEditable", { value: true });
    expect(press("a", {}, editable).defaultPrevented).toBe(false);
    expect(takeTyped().text).toBe("");
  });

  it("keeps characters and Backspace typed where no field has focus", () => {
    bufferTyping();
    for (const key of " Plan x") press(key);
    expect(press("Backspace").defaultPrevented).toBe(true);
    expect(takeTyped()).toEqual({ text: "Plan ", entered: false });
  });

  it("leaves keys with a modifier, and keys typed into a field, alone", () => {
    bufferTyping();
    expect(press("k", { metaKey: true }).defaultPrevented).toBe(false);
    const field = document.body.appendChild(document.createElement("input"));
    expect(press("a", {}, field).defaultPrevented).toBe(false);
    expect(takeTyped().text).toBe("");
  });

  it("stops at Enter, which moves on to the body", () => {
    bufferTyping("Ti");
    press("t"); press("Enter"); press("x");
    expect(takeTyped()).toEqual({ text: "Tit", entered: true });
  });

  it("takes what the title field holds once it has the keys, and nothing after being taken", () => {
    bufferTyping();
    setTyped("From the field", true);
    expect(takeTyped()).toEqual({ text: "From the field", entered: true });
    press("z");
    expect(takeTyped()).toEqual({ text: "", entered: false });
  });

  it("takes focus from a field as it starts (the closing palette), but leaves the starter's own title focused", () => {
    const field = document.body.appendChild(document.createElement("input"));
    field.focus();
    bufferTyping();
    expect(document.activeElement).not.toBe(field);
    takeTyped();
    field.focus();
    bufferTyping("Pl", true);
    expect(document.activeElement).toBe(field);
  });

  it("starts only for a plain click: a modified one opens another tab", () => {
    const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
    expect(plainClick(click)).toBe(true);
    expect(plainClick({ ...click, metaKey: true })).toBe(false);
    expect(plainClick({ ...click, ctrlKey: true })).toBe(false);
    expect(plainClick({ ...click, shiftKey: true })).toBe(false);
    expect(plainClick({ ...click, button: 1 })).toBe(false);
  });

  it("knows the new-note address, but not the compose form", () => {
    expect(isNewNoteHref("/w/a/knowledge/new")).toBe(true);
    expect(isNewNoteHref("/w/a/knowledge/new?folder=x")).toBe(true);
    expect(isNewNoteHref("/w/a/knowledge/new?compose")).toBe(false);
    expect(isNewNoteHref("/w/a/knowledge/newer")).toBe(false);
  });
});
