import { expect, it } from "vitest";
import { expiresSoon } from "@/lib/share-expiry";

const now = new Date("2026-10-22T12:00:00Z");
const later = (hours: number) => new Date(now.getTime() + hours * 3600_000);

it("says nothing while more than three days are left", () => {
  expect(expiresSoon(later(30 * 24), now)).toBeNull();
  expect(expiresSoon(later(72 + 1), now)).toBeNull();
});

it("says how many days are left from three days out, counting a part day as a day", () => {
  expect(expiresSoon(later(72), now)).toBe("in 3 days");
  expect(expiresSoon(later(49), now)).toBe("in 3 days");
  expect(expiresSoon(later(48), now)).toBe("in 2 days");
  expect(expiresSoon(later(25), now)).toBe("in 2 days");
});

it("says less than a day in its last day, never 'in 1 days' or 'in 0 days'", () => {
  expect(expiresSoon(later(24), now)).toBe("in less than a day");
  expect(expiresSoon(later(0.5), now)).toBe("in less than a day");
  // A page rendered just as the link lapses still says something sensible.
  expect(expiresSoon(later(-1), now)).toBe("in less than a day");
});

it("reads the ISO string the server projection may carry", () => {
  expect(expiresSoon(later(48).toISOString(), now)).toBe("in 2 days");
});
