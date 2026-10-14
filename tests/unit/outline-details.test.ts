// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { openAncestorDetails } from "@/components/knowledge/use-active-heading";
function heading(): HTMLElement {
  document.body.innerHTML = `<article><details id="a"><summary>T</summary><div><details id="b"><summary>U</summary><div><h2 id="h">Hi</h2></div></details></div></details></article>`;
  const h = document.getElementById("h");
  expect(h).not.toBeNull();
  return h as HTMLElement;
}
describe("openAncestorDetails", () => {
  it("opens closed ancestor disclosures", () => {
    openAncestorDetails(heading());
    expect((document.getElementById("a") as HTMLDetailsElement).open).toBe(true);
    expect((document.getElementById("b") as HTMLDetailsElement).open).toBe(true);
  });
  it("tolerates headings with no details ancestors", () => {
    document.body.innerHTML = `<article><h2 id="h">Hi</h2></article>`;
    const h = document.getElementById("h");
    expect(h).not.toBeNull();
    expect(() => openAncestorDetails(h as HTMLElement)).not.toThrow();
  });
});
