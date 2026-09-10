import { describe, expect, it } from "vitest";
import { isUuid, uuidv7 } from "@/shared/ids/uuidv7";

describe("UUIDv7 identifiers", () => {
  it("emits RFC 9562 version and variant bits and is monotonic within one millisecond", () => {
    const first = uuidv7(1_700_000_000_000);
    const second = uuidv7(1_700_000_000_000);
    expect(isUuid(first)).toBe(true);
    expect(first[14]).toBe("7");
    expect(/[89ab]/i.test(first[19])).toBe(true);
    expect(second > first).toBe(true);
  });

  it("rejects timestamps outside the UUIDv7 48-bit range", () => {
    expect(() => uuidv7(-1)).toThrow(RangeError);
    expect(() => uuidv7(0x1_0000_0000_0000)).toThrow(RangeError);
  });
});
