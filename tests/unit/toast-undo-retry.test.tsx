// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/w/w1/knowledge" }));
import { RetryableUndoError, ToastProvider, useToast } from "@/components/ui/toast";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { document.body.innerHTML = ""; });

/**
 * React's `onAnimationEnd` reads `animationName`, so the event has to carry one. The event name
 * differs under jsdom: having no `AnimationEvent`, it makes React register the webkit-prefixed name.
 * A browser has the constructor and uses `animationend`.
 */
const ANIMATION_END = "AnimationEvent" in window ? "animationend" : "webkitAnimationEnd";
function endAnimation(target: Element, animationName: string) {
  const event = new Event(ANIMATION_END, { bubbles: true });
  Object.defineProperty(event, "animationName", { value: animationName });
  target.dispatchEvent(event);
}

it("leaves through the exit animation, and only the toast's own exit unmounts it", async () => {
  let show!: ReturnType<typeof useToast>;
  function Harness() {
    show = useToast();
    return null;
  }
  const element = document.body.appendChild(document.createElement("div"));
  const root = createRoot(element);
  const toast = () => element.querySelector<HTMLElement>(".kh-toast");
  await act(async () => root.render(createElement(ToastProvider, null, createElement(Harness))));
  await act(async () => show({ message: "Saved." }));

  // The entry animation ending, or an animation inside the toast, is not the exit.
  await act(async () => endAnimation(toast()!, "kh-toast-enter"));
  expect(toast()).not.toBeNull();
  await act(async () => endAnimation(toast()!.firstElementChild!, "kh-toast-leave"));
  expect(toast()).not.toBeNull();

  await act(async () => { element.querySelector<HTMLButtonElement>('button[aria-label="Dismiss notification"]')!.click(); });
  expect(toast()?.hasAttribute("data-leaving")).toBe(true);
  expect(toast()).not.toBeNull();

  await act(async () => endAnimation(toast()!, "kh-toast-leave"));
  expect(toast()).toBeNull();
  await act(async () => root.unmount());
});

it("preserves Undo after a temporary source busy refusal so the reader can retry", async () => {
  let show!: ReturnType<typeof useToast>;
  function Harness() {
    show = useToast();
    return null;
  }
  const element = document.body.appendChild(document.createElement("div"));
  const root = createRoot(element);
  const undo = vi.fn().mockRejectedValueOnce(new RetryableUndoError("A tree change is still in progress.")).mockResolvedValue(undefined);
  await act(async () => root.render(createElement(ToastProvider, null, createElement(Harness))));
  await act(async () => show({ message: "Moved.", undo: { label: "Undo", run: undo } }));
  const undoButton = () => Array.from(element.querySelectorAll("button")).find((button) => button.textContent === "Undo")!;
  expect(undoButton()).toBeDefined();
  await act(async () => { undoButton().click(); });
  expect(undo).toHaveBeenCalledTimes(1);
  expect(undoButton()).toBeDefined();
  expect(element.textContent).toContain("Try Undo again");
  await act(async () => { undoButton().click(); });
  expect(undo).toHaveBeenCalledTimes(2);
  expect(element.textContent).toContain("Undone.");
  await act(async () => root.unmount());
});
