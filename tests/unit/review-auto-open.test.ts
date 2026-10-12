import { describe, expect, it } from "vitest";
import { awaitingOwner, opensOnArrival, parseDismissed } from "@/components/knowledge/review-auto-open";

const thread = (id: string, status: "OPEN" | "RESOLVED" = "OPEN", visibility: "VISIBLE" | "HIDDEN" = "VISIBLE") => ({ id, status, visibility });

/**
 * When the owner's discussions open by themselves
 * (docs/superpowers/specs/2026-10-12-owner-comments-rail-design.md, "Open on arrival").
 */
describe("the owner's discussions on arrival", () => {
  it("await the owner where a discussion is open and has not been hidden", () => {
    expect(awaitingOwner([thread("a"), thread("b", "RESOLVED"), thread("c", "OPEN", "HIDDEN"), thread("d")])).toEqual(["a", "d"]);
  });

  it.each([
    ["one discussion awaits", [thread("a")], [], true],
    ["one awaits among resolved ones", [thread("a", "RESOLVED"), thread("b")], [], true],
    ["there is no discussion", [], [], false],
    ["every discussion is resolved", [thread("a", "RESOLVED"), thread("b", "RESOLVED")], [], false],
    ["the only open one was hidden by the owner", [thread("a", "OPEN", "HIDDEN")], [], false],
    ["the owner closed the rail on exactly these", [thread("a"), thread("b")], ["a", "b"], false],
    ["the owner closed the rail and one of those has since been resolved", [thread("a", "RESOLVED"), thread("b")], ["a", "b"], false],
    ["a discussion has arrived since the owner closed the rail", [thread("a"), thread("b")], ["a"], true],
    ["one the owner closed the rail on was resolved and is open again", [thread("a")], ["a"], false],
  ])("open by themselves when %s: %s", (_name, threads, dismissed, opens) => {
    expect(opensOnArrival(threads, dismissed)).toBe(opens);
  });

  it.each([
    [null, []],
    ["", []],
    ["not json", []],
    ['{"a":1}', []],
    ['["a",2,"b",null]', ["a", "b"]],
  ])("read what was stored about a closed rail, whatever is there: %s", (stored, ids) => {
    expect(parseDismissed(stored)).toEqual(ids);
  });
});
