import { afterEach, describe, expect, it, vi } from "vitest";
import { helpTaskSearchEnabled } from "@/server/help-config";

describe("helpTaskSearchEnabled", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("is true only for the exact flag value", () => {
    vi.stubEnv("TASK_SEARCH_READ_ENABLED", "true");
    expect(helpTaskSearchEnabled()).toBe(true);
    for (const value of ["false", "1", "TRUE", ""]) {
      vi.stubEnv("TASK_SEARCH_READ_ENABLED", value);
      expect(helpTaskSearchEnabled()).toBe(false);
    }
  });
});
