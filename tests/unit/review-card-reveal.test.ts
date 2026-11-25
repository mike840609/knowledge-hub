// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { revealReviewCard } from "@/components/knowledge/review-rail-mode";

/**
 * A card jumped to (a passage's marker, Next open) is shown below the rail's pinned toolbar, not
 * under it: its quote and author line are what say which discussion it is.
 */
let panel: HTMLElement;
let toolbar: HTMLElement;
let card: HTMLElement;
let scrolled: ScrollIntoViewOptions[];

const sized = (element: HTMLElement, height: number) => Object.defineProperty(element, "offsetHeight", { configurable: true, value: height });

beforeEach(() => {
  scrolled = [];
  panel = document.body.appendChild(document.createElement("aside"));
  panel.className = "kh-review-panel";
  toolbar = panel.appendChild(document.createElement("div"));
  toolbar.className = "kh-review-toolbar";
  card = panel.appendChild(document.createElement("section"));
  card.scrollIntoView = (options?: boolean | ScrollIntoViewOptions) => { scrolled.push(options as ScrollIntoViewOptions); };
  sized(toolbar, 160);
  vi.stubGlobal("innerHeight", 700);
});
afterEach(() => { panel.remove(); vi.unstubAllGlobals(); });

test("a card beside a pinned toolbar is scrolled to clear it, by as much as the toolbar takes and the rail's gap", () => {
  toolbar.style.position = "sticky";
  toolbar.style.top = "48px";
  sized(card, 200);
  revealReviewCard(card, "center", "smooth");
  expect(card.style.scrollMarginTop).toBe(`${48 + 160 + 12}px`);
  expect(scrolled).toEqual([{ block: "center", behavior: "smooth" }]);
});

test("a card too tall to fit below the toolbar is shown from its top", () => {
  toolbar.style.position = "sticky";
  toolbar.style.top = "48px";
  sized(card, 600);
  revealReviewCard(card, "nearest");
  expect(scrolled).toEqual([{ block: "start", behavior: "auto" }]);
});

test("in the drawer, where nothing is pinned over the list, it scrolls as any element does", () => {
  sized(card, 200);
  revealReviewCard(card, "nearest");
  expect(card.style.scrollMarginTop).toBe("0px");
  expect(scrolled).toEqual([{ block: "nearest", behavior: "auto" }]);
});
