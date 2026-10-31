import { describe, expect, it } from "vitest";
import { MENTION_LIMIT, normalizeMentions, splitMentions, type MentionedPerson } from "@/modules/knowledge/domain/review-mention";
import { DomainError } from "@/shared/domain/errors";
import { uuidv7 } from "@/shared/ids/uuidv7";

const writerId = uuidv7();
const ownerId = uuidv7();
const ctx = { writerId, ownerId };
const refused = (raw: unknown, c = ctx) => { try { normalizeMentions(raw, c); } catch (e) { return e; } return null; };

describe("normalizeMentions", () => {
  it("reads nothing as no mentions", () => {
    expect(normalizeMentions(undefined, ctx)).toEqual([]);
    expect(normalizeMentions([], ctx)).toEqual([]);
  });
  it("de-duplicates, keeping first-seen order", () => {
    const [a, b] = [uuidv7(), uuidv7()];
    expect(normalizeMentions([a, a, b, a], ctx)).toEqual([a, b]);
  });
  it("drops the writer and the owner, possibly leaving nothing", () => {
    const a = uuidv7();
    expect(normalizeMentions([writerId, a, ownerId], ctx)).toEqual([a]);
    expect(normalizeMentions([writerId, ownerId], ctx)).toEqual([]);
  });
  it("treats upper-case ids as the same user", () => {
    const a = uuidv7();
    expect(normalizeMentions([a, a.toUpperCase()], ctx)).toEqual([a]);
    expect(normalizeMentions([writerId.toUpperCase(), ownerId.toUpperCase(), a.toUpperCase()], ctx)).toEqual([a]);
  });
  it("has no owner to drop when ownerId is null", () => {
    const a = uuidv7();
    expect(normalizeMentions([a, writerId], { writerId, ownerId: null })).toEqual([a]);
  });
  it("accepts exactly the limit and refuses one more", () => {
    const ids = Array.from({ length: MENTION_LIMIT + 1 }, () => uuidv7());
    expect(normalizeMentions(ids.slice(0, MENTION_LIMIT), ctx)).toHaveLength(MENTION_LIMIT);
    expect(refused(ids)).toMatchObject({ code: "INVALID_REQUEST" });
  });
  it("counts distinct targets, not repeats or dropped ones", () => {
    const ids = Array.from({ length: MENTION_LIMIT }, () => uuidv7());
    expect(normalizeMentions([...ids, ...ids, writerId, ownerId], ctx)).toHaveLength(MENTION_LIMIT);
  });
  it.each([["a non-array", "x"], ["an object", {}], ["null", null], ["a non-string element", [1]], ["a null element", [null]], ["a non-UUID string", ["not-a-uuid"]]])("refuses %s", (_name, raw) => {
    const error = refused(raw);
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code: "INVALID_REQUEST" });
  });
});

describe("splitMentions", () => {
  const person = (name: string, empId: string): MentionedPerson => ({ name, nameEn: null, empId });
  const chen = person("陳小明", "E1");
  const ann = person("Ann", "E1");
  const joined = (text: string, people: MentionedPerson[]) => splitMentions(text, people).map(p => p.text).join("");

  it("marks a whole @name", () => {
    const text = "@陳小明 please check";
    expect(splitMentions(text, [chen])).toEqual([{ text: "@陳小明", people: [chen] }, { text: " please check" }]);
    expect(joined(text, [chen])).toBe(text);
  });
  it("ends at punctuation or end", () => {
    const text = "cc @Ann, @Ann";
    const parts = splitMentions(text, [ann]);
    expect(parts.filter(p => p.people).map(p => p.text)).toEqual(["@Ann", "@Ann"]);
    expect(joined(text, [ann])).toBe(text);
  });
  it("a longer word is not the shorter name", () => {
    const text = "@陳小明華 hi";
    expect(splitMentions(text, [chen])).toEqual([{ text }]);
    expect(joined(text, [chen])).toBe(text);
  });
  it("longest name first", () => {
    const long = person("陳小明華", "E2");
    const text = "@陳小明華 and @陳小明";
    const mentions = splitMentions(text, [chen, long]).filter(p => p.people);
    expect(mentions.map(p => p.people)).toEqual([[long], [chen]]);
    expect(joined(text, [chen, long])).toBe(text);
  });
  it("same-name people share every occurrence", () => {
    const [a1, a2] = [person("Ann", "E1"), person("Ann", "E2")];
    const text = "@Ann and @Ann";
    const mentions = splitMentions(text, [a1, a2]).filter(p => p.people);
    expect(mentions.map(p => p.people)).toEqual([[a1, a2], [a1, a2]]);
    expect(joined(text, [a1, a2])).toBe(text);
  });
  it("unmentioned @ stays plain", () => {
    expect(splitMentions("mail @Bob", [chen])).toEqual([{ text: "mail @Bob" }]);
  });
  it("no people, one part; no text, no parts", () => {
    expect(splitMentions("a @b", [])).toEqual([{ text: "a @b" }]);
    expect(splitMentions("", [chen])).toEqual([]);
  });
});
