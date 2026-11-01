// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/w/w1/knowledge" }));
import { RetryableUndoError, ToastProvider, useToast } from "@/components/ui/toast";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { document.body.innerHTML = ""; });

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
