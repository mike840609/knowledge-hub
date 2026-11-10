import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
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

  it("writes knowledge-hub.tgz under its fixed name, and nothing beside it, not even a hidden staging directory", () => {
    expect(existsSync(path.join(out, "knowledge-hub.tgz"))).toBe(true);
    expect(readdirSync(out)).toEqual(["knowledge-hub.tgz"]);
  });

  it("packs into a directory whose path has a space", () => {
    const spaced = mkdtempSync(path.join(tmpdir(), "kh pack "));
    try {
      expect(spawnSync(process.execPath, ["scripts/pack-cli.mjs", spaced], { encoding: "utf8" }).status).toBe(0);
      expect(readdirSync(spaced)).toEqual(["knowledge-hub.tgz"]);
    } finally {
      rmSync(spaced, { recursive: true, force: true });
    }
  }, 60_000);

  it("two packers started together into one directory both succeed", async () => {
    const shared = mkdtempSync(path.join(tmpdir(), "kh-pack-race-"));
    const pack = () => new Promise<number | null>((resolve) => {
      const child = spawn(process.execPath, ["scripts/pack-cli.mjs", shared], { stdio: "ignore" });
      child.on("close", resolve);
    });
    try {
      expect(await Promise.all([pack(), pack(), pack()])).toEqual([0, 0, 0]);
      expect(readdirSync(shared)).toEqual(["knowledge-hub.tgz"]);
      expect(spawnSync("tar", ["-tzf", path.join(shared, "knowledge-hub.tgz")]).status).toBe(0);
    } finally {
      rmSync(shared, { recursive: true, force: true });
    }
  }, 60_000);

  it("holds the CLI and the Skills an npm install needs", () => {
    for (const file of ["package/package.json", "package/bin/knowledge-hub.mjs", "package/src/export.mjs", "package/src/read.mjs", "package/agent/hub-export/SKILL.md", "package/agent/opencode/hub-export.md", "package/agent/hub-search/SKILL.md", "package/agent/hub-read/SKILL.md", "package/agent/opencode/hub-search.md", "package/agent/opencode/hub-read.md"]) {
      expect(listing).toContain(file);
    }
  });

  it("holds nothing outside the package's own files", () => {
    for (const entry of listing) expect(entry).toMatch(/^package\/(?:package\.json|README\.md|bin\/|src\/|agent\/)/);
  });
});
