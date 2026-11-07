// @vitest-environment jsdom
import { act } from "react";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { TaskSearchDateOffsetSubmit } from "@/components/task-knowledge/task-search-date-offset-submit";

let node: HTMLDivElement | null = null;
let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  node?.remove();
  root = null;
  node = null;
});

describe("native Tasks GET date offset", () => {
  it("removes stale offset when both dates are cleared on a previously dated page", async () => {
    node = document.createElement("div");
    document.body.appendChild(node);
    root = createRoot(node);
    await act(async () => {
      root?.render(
        <form id="task-date-form" action="/tasks" method="get">
          <input type="date" name="from" defaultValue="" />
          <input type="date" name="to" defaultValue="" />
          <input type="hidden" name="offset" defaultValue="480" />
          <TaskSearchDateOffsetSubmit formId="task-date-form" />
        </form>,
      );
    });
    const form = node.querySelector("form")!;
    form.dispatchEvent(new Event("submit", {bubbles:true, cancelable:true}));
    expect(new FormData(form).has("offset")).toBe(false);
  });
});
