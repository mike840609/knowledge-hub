import { describe, expect, it } from "vitest";
import { MENTION_LIMIT, normalizeMentions } from "@/modules/knowledge/domain/review-mention";
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
