import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { THEME_PRE_PAINT_SCRIPT, THEME_PRE_PAINT_SCRIPT_HASH } from "@/app/theme-script";
import { contentSecurityPolicy } from "@/lib/content-security-policy";

/** The policy as a browser reads it: each directive, and the sources it lists. */
function directives(policy: string): Record<string, string[]> {
  return Object.fromEntries(policy.split(";").map((part) => part.trim().split(/\s+/)).map(([name, ...sources]) => [name, sources]));
}

describe("the Content-Security-Policy", () => {
  const policy = directives(contentSecurityPolicy({ nonce: "Tm9uY2U=", pathname: "/w/ws/knowledge", development: false }));

  it("runs only scripts that carry this response's nonce, and what they load", () => {
    expect(policy["script-src"]).toEqual(["'self'", "'nonce-Tm9uY2U='", "'strict-dynamic'", `'${THEME_PRE_PAINT_SCRIPT_HASH}'`]);
  });

  it("never allows inline script or eval in production", () => {
    expect(policy["script-src"]).not.toContain("'unsafe-inline'");
    expect(policy["script-src"]).not.toContain("'unsafe-eval'");
  });

  it("allows eval in development only, which React's dev build needs", () => {
    const dev = directives(contentSecurityPolicy({ nonce: "n", pathname: "/", development: true }));
    expect(dev["script-src"]).toContain("'unsafe-eval'");
    expect(dev["script-src"]).not.toContain("'unsafe-inline'");
  });

  it("keeps the image lockdown (issue #20) but for images this origin's own script made, and shuts plugins and <base>", () => {
    // `blob:` is the drawn diagram (reader-mermaid spec): a URL only script here can mint, and a document cannot name.
    expect(policy["img-src"]).toEqual(["'self'", "blob:"]);
    expect(policy["object-src"]).toEqual(["'none'"]);
    expect(policy["base-uri"]).toEqual(["'self'"]);
  });

  it("loads no audio or video from anywhere: the product plays none, and a diagram being laid out must not fetch one", () => {
    // reader-mermaid spec, "What B does not cover": with no `default-src`, a kind of fetch is open until it is named.
    expect(policy["media-src"]).toEqual(["'none'"]);
    expect(policy["default-src"]).toBeUndefined();
  });

  it("says the same about images on a shared page, and where the middleware does not run", async () => {
    const shared = directives(contentSecurityPolicy({ nonce: "n", pathname: "/s/0b1c2d3e-0000-4000-8000-000000000000", development: false }));
    expect(shared["img-src"]).toEqual(["'self'", "blob:"]);
    expect(shared["media-src"]).toEqual(["'none'"]);
    // next.config.ts writes the directive twice more; a change in one place only is lost on some responses.
    const { default: config } = await import("../../next.config");
    const values = (await config.headers!()).flatMap((rule) => rule.headers).filter((header) => header.key === "Content-Security-Policy").map((header) => header.value);
    expect(values).toHaveLength(2);
    for (const value of values) expect(directives(value)["img-src"]).toEqual(["'self'", "blob:"]);
    for (const value of values) expect(directives(value)["media-src"]).toEqual(["'none'"]);
  });

  it.each([["/s/0b1c2d3e-0000-4000-8000-000000000000"], ["/s/x/y"]])("lets no site frame a shared page: %s", (pathname) => {
    expect(directives(contentSecurityPolicy({ nonce: "n", pathname, development: false }))["frame-ancestors"]).toEqual(["'none'"]);
  });

  it.each([["/"], ["/w/ws/home"], ["/settings"], ["/sx"]])("says nothing about framing elsewhere, as before: %s", (pathname) => {
    expect(directives(contentSecurityPolicy({ nonce: "n", pathname, development: false }))["frame-ancestors"]).toBeUndefined();
  });

  it("names the theme script by the hash of what it is", () => {
    // `global-error` is a client component and cannot be given the nonce; its copy of the script runs by this.
    expect(THEME_PRE_PAINT_SCRIPT_HASH).toBe(`sha256-${createHash("sha256").update(THEME_PRE_PAINT_SCRIPT).digest("base64")}`);
  });
});
