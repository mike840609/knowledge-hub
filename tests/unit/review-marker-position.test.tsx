// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { shownTop } from "@/components/knowledge/review-passage-markers";

// Chromium reports a rectangle for text in a closed <details>, laid out as if it were open. jsdom
// lays nothing out, so each test says where things are.
function at(element: Element, top: number) {
  element.getBoundingClientRect = () => ({ top, y: top, bottom: top + 10, left: 0, right: 0, width: 0, height: 10, x: 0, toJSON() {} }) as DOMRect;
}

function rangeIn(element: Element, rectTop: number | null) {
  const range = document.createRange();
  range.selectNodeContents(element.firstChild!);
  range.getClientRects = () => (rectTop === null ? [] : [{ top: rectTop }]) as unknown as DOMRectList;
  return range;
}

afterEach(() => { document.body.innerHTML = ""; });

describe("where a passage marker sits", () => {
  test("beside the closed disclosure around a quote the browser still reports a rectangle for", () => {
    document.body.innerHTML = "<details id=d><summary>Source</summary><p id=p>hidden</p></details>";
    at(document.getElementById("d")!, 300);
    expect(shownTop(rangeIn(document.getElementById("p")!, 520))).toBe(300);
  });

  test("beside the outermost of two closed disclosures, not the innermost", () => {
    document.body.innerHTML = "<details id=o><summary>Outer</summary><details id=i><summary>Inner</summary><p id=p>hidden</p></details></details>";
    at(document.getElementById("o")!, 100);
    at(document.getElementById("i")!, 140);
    expect(shownTop(rangeIn(document.getElementById("p")!, 400))).toBe(100);
  });

  test("beside the closed outer disclosure when the one inside it is open", () => {
    document.body.innerHTML = "<details id=o><summary>Outer</summary><details open id=i><summary>Inner</summary><p id=p>hidden</p></details></details>";
    at(document.getElementById("o")!, 100);
    at(document.getElementById("i")!, 140);
    expect(shownTop(rangeIn(document.getElementById("p")!, 400))).toBe(100);
  });

  test("at the quote itself when its disclosure is open", () => {
    document.body.innerHTML = "<details open id=d><summary>Source</summary><p id=p>shown</p></details>";
    at(document.getElementById("d")!, 300);
    expect(shownTop(rangeIn(document.getElementById("p")!, 340))).toBe(340);
  });

  test("at the quote itself when it is the summary of a closed disclosure", () => {
    document.body.innerHTML = "<details id=d><summary id=s>Source</summary><p>hidden</p></details>";
    at(document.getElementById("d")!, 300);
    expect(shownTop(rangeIn(document.getElementById("s")!, 305))).toBe(305);
  });

  test("at the quote itself when it is in no disclosure at all", () => {
    document.body.innerHTML = "<article id=a><p id=p>shown</p></article>";
    at(document.getElementById("a")!, 50);
    expect(shownTop(rangeIn(document.getElementById("p")!, 70))).toBe(70);
  });

  test("beside the closed disclosure when the browser reports no rectangle at all", () => {
    document.body.innerHTML = "<details id=d><summary>Source</summary><p id=p>hidden</p></details>";
    at(document.getElementById("d")!, 300);
    expect(shownTop(rangeIn(document.getElementById("p")!, null))).toBe(300);
  });
});
