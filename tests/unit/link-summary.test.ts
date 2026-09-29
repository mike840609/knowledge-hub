import { describe, expect, it } from "vitest";
import { summariseLinks } from "@/components/knowledge/link-summary";
import type { OutgoingLinkView } from "@/modules/knowledge/application/knowledge-link-service";

// Only `resolution` matters to the phrase; the rest of a link view is not its business.
const resolved = (id: string) =>
  ({ resolution: { status: "RESOLVED", documentId: id, sourceId: "s", title: id, ambiguousWith: 0 } }) as unknown as OutgoingLinkView;
const unresolved = () => ({ resolution: { status: "UNRESOLVED" } }) as unknown as OutgoingLinkView;

describe("summariseLinks", () => {
  it("leads with backlinks, counted from the total rather than the capped list", () => {
    expect(summariseLinks({ backlinkTotal: 3, outgoing: [resolved("a"), resolved("b")] })).toBe("3 backlinks");
    expect(summariseLinks({ backlinkTotal: 1, outgoing: [] })).toBe("1 backlink");
    // The list is capped; the phrase must agree with the count on the tab it opens.
    expect(summariseLinks({ backlinkTotal: 250, outgoing: [] })).toBe("250 backlinks");
  });

  it("falls back to outgoing links when nothing links here, so a connected document is still findable", () => {
    expect(summariseLinks({ backlinkTotal: 0, outgoing: [resolved("a"), resolved("b")] })).toBe("2 outgoing links");
    expect(summariseLinks({ backlinkTotal: 0, outgoing: [resolved("a")] })).toBe("1 outgoing link");
  });

  it("does not count links that go nowhere", () => {
    expect(summariseLinks({ backlinkTotal: 0, outgoing: [resolved("a"), unresolved(), unresolved()] })).toBe("1 outgoing link");
  });

  it("says nothing for a document with no links, or only unresolved ones, or when links could not be read", () => {
    expect(summariseLinks({ backlinkTotal: 0, outgoing: [] })).toBeNull();
    expect(summariseLinks({ backlinkTotal: 0, outgoing: [unresolved()] })).toBeNull();
    expect(summariseLinks(null)).toBeNull();
  });
});
