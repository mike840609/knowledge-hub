// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AutosaveIndicator } from "@/components/knowledge/autosave-indicator";
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); });
function show(state: string, attention?: string) { act(() => root.render(<AutosaveIndicator state={state} attention={attention} />)); }
it("keeps opening, pending input and fast success quiet", () => {
  show("saved"); expect(container.textContent).toBe("");
  show("pending"); expect(container.textContent).toBe("");
  show("saving"); act(() => vi.advanceTimersByTime(500));
  show("saved"); act(() => vi.advanceTimersByTime(3000));
  expect(container.textContent).toBe("");
});
it("shows slow saves after one second, confirms success, then hides", () => {
  show("saving"); act(() => vi.advanceTimersByTime(999)); expect(container.textContent).toBe("");
  act(() => vi.advanceTimersByTime(1)); expect(container.textContent).toBe("Saving…");
  show("saved"); expect(container.textContent).toBe("Saved");
  act(() => vi.advanceTimersByTime(2000)); expect(container.textContent).toBe("");
});
it("keeps errors visible until addressed", () => {
  show("error", "Not saved"); act(() => vi.advanceTimersByTime(10000));
  expect(container.textContent).toBe("Not saved");
  show("saving"); expect(container.textContent).toBe("");
});
