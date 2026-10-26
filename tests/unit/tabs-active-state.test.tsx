// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TabsList, TabsPanel, TabsRoot, TabsTab } from "@/components/ui/tabs";
import { selectableTabClasses } from "@/components/ui/tab";

/**
 * The current tab's look is keyed on an attribute Base UI sets. It was keyed on `data-selected`, which this
 * version of the library never sets, so the inspector showed no current tab and nothing failed. This reads the
 * attributes the classes name from the classes themselves and checks them against what the library renders.
 */
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderTabs(value: string) {
  await act(async () => {
    root.render(
      <TabsRoot defaultValue={value}>
        <TabsList aria-label="Example">
          <TabsTab value="details">Details</TabsTab>
          <TabsTab value="links">Links</TabsTab>
        </TabsList>
        <TabsPanel value="details">Details panel</TabsPanel>
        <TabsPanel value="links">Links panel</TabsPanel>
      </TabsRoot>,
    );
  });
  const tab = (name: string) => [...container.querySelectorAll('[role="tab"]')].find((el) => el.textContent === name)!;
  return { details: tab("Details"), links: tab("Links") };
}

const keyedAttributes = [...new Set([...selectableTabClasses.matchAll(/data-\[([a-z-]+)\]:/g)].map((match) => `data-${match[1]}`))];

it("styles the current tab through an attribute at all", () => {
  expect(keyedAttributes.length).toBeGreaterThan(0);
});

it("keys the current tab's look on attributes Base UI sets on the current tab only", async () => {
  const { details, links } = await renderTabs("details");
  for (const attribute of keyedAttributes) {
    expect(details.hasAttribute(attribute), attribute).toBe(true);
    expect(links.hasAttribute(attribute), attribute).toBe(false);
  }
});

it("moves that attribute with the selection", async () => {
  const { details, links } = await renderTabs("links");
  for (const attribute of keyedAttributes) {
    expect(links.hasAttribute(attribute), attribute).toBe(true);
    expect(details.hasAttribute(attribute), attribute).toBe(false);
  }
});

it("gives a tab the shared tab classes", async () => {
  const { details } = await renderTabs("details");
  expect(details.className).toContain(selectableTabClasses);
});
