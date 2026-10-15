// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { findHeading } from "@/components/knowledge/use-active-heading";

// jsdom has no CSS.escape; the ids here need none.
globalThis.CSS ??= { escape: (value: string) => value } as typeof CSS;
afterEach(() => { document.body.innerHTML = ""; });

it("resolves identical slugs inside each pane's own root", () => {
  document.body.innerHTML =
    `<div data-document-pane id="pane-a"><article><h2 id="setup">Main Setup</h2></article></div>` +
    `<div data-document-pane id="pane-b"><article><h2 id="setup">Peek Setup</h2></article></div>`;
  const paneA = document.querySelector("#pane-a") as HTMLElement;
  const paneB = document.querySelector("#pane-b") as HTMLElement;
  expect(findHeading("setup", paneA)?.textContent).toBe("Main Setup");
  expect(findHeading("setup", paneB)?.textContent).toBe("Peek Setup");
  // Unscoped single-pane behaviour is unchanged: the first pane wins.
  expect(findHeading("setup")?.textContent).toBe("Main Setup");
});

it("resolves identical slugs inside each pane's scroll container", () => {
  document.body.innerHTML =
    `<div data-document-pane><div id="root-a"><article><h2 id="setup">Main Setup</h2></article></div></div>` +
    `<div data-document-pane><div id="root-b"><article><h2 id="setup">Peek Setup</h2></article></div></div>`;
  const rootA = document.querySelector("#root-a") as HTMLElement;
  const rootB = document.querySelector("#root-b") as HTMLElement;
  expect(findHeading("setup", rootA)?.textContent).toBe("Main Setup");
  expect(findHeading("setup", rootB)?.textContent).toBe("Peek Setup");
});
