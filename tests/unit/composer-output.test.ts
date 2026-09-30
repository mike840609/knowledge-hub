import { describe, expect, it } from "vitest";
import { matchesInitial } from "@/lib/composer-output";

// Composer spec §11.2 release rule: content identical to the initial content
// is not a modification — `touched` releases, wherever the content arrived
// from (rendered output, a flush, or source edits). Issue #65: typing then
// reverting inside the 200 ms output debounce emits no output, so no output
// ever releases `touched`; the flush and the source path must compare instead.
describe("matchesInitial", () => {
  const initial = { markdown: "# T\n", title: "T" };

  it("releases when the flushed content is back at the initial content (issue #65 probe: 2 edits, no output)", () => {
    // The editor reports { edits: 2, markdown: [] } for type-then-revert
    // inside the debounce; the flushed document still matches the initial one.
    expect(matchesInitial({ markdown: "# T\n", title: "T" }, initial)).toBe(true);
  });

  it("releases a source-view revert to the initial text", () => {
    expect(matchesInitial({ markdown: "# T\n", title: "T" }, initial)).toBe(true);
  });

  it("holds when the markdown differs, even only by normalization", () => {
    expect(matchesInitial({ markdown: "# T\n\n- a\n", title: "T" }, initial)).toBe(false);
    expect(matchesInitial({ markdown: "# T", title: "T" }, initial)).toBe(false);
  });

  it("holds when only the title differs", () => {
    expect(matchesInitial({ markdown: "# T\n", title: "Changed" }, initial)).toBe(false);
  });
});
