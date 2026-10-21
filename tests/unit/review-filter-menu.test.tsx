// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ReviewFilterMenu } from "@/components/knowledge/review-thread-list";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("the filter marks the current choice and reports a new one", async () => {
  const onChange = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(<ReviewFilterMenu value="OPEN" onChange={onChange} />));
  await act(async () => (document.querySelector('[aria-label="Filter discussions"]') as HTMLElement).click());
  const rows = [...document.querySelectorAll('[role="menuitemradio"]')] as HTMLElement[];
  expect(rows.map(row => [row.textContent, row.getAttribute("aria-checked")])).toEqual([["All comments", "false"], ["Open", "true"], ["Resolved", "false"]]);
  await act(async () => rows[2].click());
  expect(onChange).toHaveBeenCalledWith("RESOLVED");
  await act(async () => root.unmount());
});
