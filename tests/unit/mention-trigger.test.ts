import { describe, expect, it } from "vitest";
import { mentionTrigger } from "@/components/knowledge/mention-autocomplete";

describe("the @ trigger", () => {
  it("opens after CJK text and punctuation", () => {
    expect(mentionTrigger("請@王", 3)).toEqual({ start: 1, query: "王" });
    expect(mentionTrigger("(@Amy", 5)).toEqual({ start: 1, query: "Amy" });
  });

  it("still opens at the start and after a space", () => {
    expect(mentionTrigger("@Amy", 4)).toEqual({ start: 0, query: "Amy" });
    expect(mentionTrigger("look @Am", 8)).toEqual({ start: 5, query: "Am" });
  });

  it("does not open inside an email or a word", () => {
    expect(mentionTrigger("name@example", 12)).toBeNull();
    expect(mentionTrigger("foo_bar@x", 9)).toBeNull();
    expect(mentionTrigger("@@Amy", 5)).toBeNull();
  });

  it("does not open inside a URL, but does after one", () => {
    for (const text of ["see https://medium.com/@john", "https://medium.com/@john/post-1", "(http://x.test/@a"]) expect(mentionTrigger(text, text.length)).toBeNull();
    expect(mentionTrigger("https://x.test/ @jo", 19)).toEqual({ start: 16, query: "jo" });
    expect(mentionTrigger("A/@B", 4)).toEqual({ start: 2, query: "B" });
    // linkify ends a URL at a quote, so the @ after it starts a mention.
    expect(mentionTrigger('https://x.test/a"@An', 20)).toEqual({ start: 17, query: "An" });
    expect(mentionTrigger("ftp://x.test/@jo", 16)).toEqual({ start: 13, query: "jo" });
  });

  it("stops at whitespace and at 32 characters", () => {
    expect(mentionTrigger("@Amy Chen", 9)).toBeNull();
    expect(mentionTrigger("@" + "a".repeat(32), 33)).toEqual({ start: 0, query: "a".repeat(32) });
    expect(mentionTrigger("@" + "a".repeat(33), 34)).toBeNull();
  });
});

it("counts the query by code point for the 32-character cap", () => {
  const emoji = "😀".repeat(32);
  expect(mentionTrigger("@" + emoji, 1 + emoji.length)).toEqual({ start: 0, query: emoji });
  expect(mentionTrigger("@" + "😀".repeat(33), 1 + 33 * 2)).toBeNull();
});

it("treats a caret before the text as no trigger", () => {
  expect(mentionTrigger("@Amy", -1)).toBeNull();
});
