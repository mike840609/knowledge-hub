import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { googleGate, isGooglePublicPath } from "@/lib/auth-paths";
import { isSitePasswordExempt } from "@/lib/site-password";

// The Hub serves the CLI it was built with (task knowledge export design, Amendment 2).
const DOWNLOAD = "/cli/knowledge-hub.tgz";

describe("the CLI download path", () => {
  it("is reachable without a session or the site password, because npm sends neither", () => {
    expect(isGooglePublicPath(DOWNLOAD)).toBe(true);
    expect(googleGate({ pathname: DOWNLOAD, search: "", hasSession: false })).toEqual({ kind: "allow" });
    expect(isSitePasswordExempt(DOWNLOAD)).toBe(true);
  });

  it.each(["/cli", "/cli/", "/cli/other.tgz", "/cli/knowledge-hub.tgz/x", "/cli/knowledge-hub.tgz.map", "/api/cli/knowledge-hub.tgz"])(
    "exempts the exact path only, never %s",
    (pathname) => {
      expect(isGooglePublicPath(pathname)).toBe(false);
      expect(isSitePasswordExempt(pathname)).toBe(false);
    },
  );
});

describe("scripts/pack-cli.mjs", () => {
  let out: string;
  let listing: string[];
  beforeAll(() => {
    out = mkdtempSync(path.join(tmpdir(), "kh-pack-"));
    const packed = spawnSync(process.execPath, ["scripts/pack-cli.mjs", out], { encoding: "utf8" });
    expect(packed.status, packed.stderr).toBe(0);
    const tar = spawnSync("tar", ["-tzf", path.join(out, "knowledge-hub.tgz")], { encoding: "utf8" });
    expect(tar.status, tar.stderr).toBe(0);
    listing = tar.stdout.split("\n").filter(Boolean);
  }, 60_000);
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  it("writes knowledge-hub.tgz under its fixed name, and nothing versioned beside it", () => {
    expect(existsSync(path.join(out, "knowledge-hub.tgz"))).toBe(true);
    expect(spawnSync("ls", [out], { encoding: "utf8" }).stdout.trim()).toBe("knowledge-hub.tgz");
  });

  it("holds the CLI and the Skill an npm install needs", () => {
    for (const file of ["package/package.json", "package/bin/knowledge-hub.mjs", "package/src/export.mjs", "package/agent/hub-export/SKILL.md", "package/agent/opencode/hub-export.md"]) {
      expect(listing).toContain(file);
    }
  });

  it("holds nothing outside the package's own files", () => {
    for (const entry of listing) expect(entry).toMatch(/^package\/(?:package\.json|README\.md|bin\/|src\/|agent\/)/);
  });
});
