import { expect, it } from "vitest";
import { parseSavedShareQuery } from "@/modules/knowledge/domain/saved-share";
it("validates saved query and defaults", () => {
  expect(parseSavedShareQuery({})).toEqual({ q: "", status: "all", page: 1 });
  expect(parseSavedShareQuery({ q: " %_! ", status: "unavailable", page: "2" })).toEqual({ q: "%_!", status: "unavailable", page: 2 });
  for (const input of [{ status: "revoked" }, { page: "0" }, { page: "1.5" }, { page: "100001" }, { q: "a".repeat(201) }]) expect(() => parseSavedShareQuery(input)).toThrow();
});
