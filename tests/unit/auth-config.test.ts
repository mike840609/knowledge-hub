import { describe, expect, it } from "vitest";
import { authConfig } from "@/auth.config";

describe("authConfig", () => {
  it("routes every Auth.js error to the login page", () => {
    expect(authConfig.pages).toMatchObject({ signIn: "/login", error: "/login" });
  });

  it("keeps Google as the only provider and uses JWT sessions", () => {
    expect(authConfig.providers).toHaveLength(1);
    expect(authConfig.session?.strategy).toBe("jwt");
  });
});
