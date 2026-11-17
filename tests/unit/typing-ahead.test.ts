// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { bufferTyping, isNewNoteHref, setTyped, takeTyped } from "@/components/knowledge/typing-ahead";

// 2026-11-19 creation-flow spec, decision 3: keys typed while a new note is being made.
const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};
afterEach(() => { takeTyped(); document.body.innerHTML = ""; });

describe("typing ahead of a new note", () => {
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

  it("knows the new-note address, but not the compose form", () => {
    expect(isNewNoteHref("/w/a/knowledge/new")).toBe(true);
    expect(isNewNoteHref("/w/a/knowledge/new?folder=x")).toBe(true);
    expect(isNewNoteHref("/w/a/knowledge/new?compose")).toBe(false);
    expect(isNewNoteHref("/w/a/knowledge/newer")).toBe(false);
  });
});
