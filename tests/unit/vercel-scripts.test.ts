import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function run(script: string, args: string[] = [], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", NODE_ENV: "test", ...env } as NodeJS.ProcessEnv,
  });
  return { status: result.status, stdout: result.stdout.trim() };
}

describe("vercel-ignore.mjs", () => {
  it("skips preview and development builds", () => {
    expect(run("scripts/vercel-ignore.mjs", [], { VERCEL_ENV: "preview" }).status).toBe(0);
    expect(run("scripts/vercel-ignore.mjs", [], { VERCEL_ENV: "development" }).status).toBe(0);
  });
  it("builds production and unset environments", () => {
    expect(run("scripts/vercel-ignore.mjs", [], { VERCEL_ENV: "production" }).status).toBe(1);
    expect(run("scripts/vercel-ignore.mjs").status).toBe(1);
  });
});

describe("vercel-build.mjs --dry-run", () => {
  it("migrates in production when a direct URL is available", () => {
    const result = run("scripts/vercel-build.mjs", ["--dry-run"], {
      VERCEL_ENV: "production", KM_DB_MIGRATE_URL: "mysql://direct/db", KM_DB_URL: "mysql://pooled/db",
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ build: true, buildScript: "scripts/build.mjs", migrate: true, migrationUrlSource: "direct" });
  });
  it("skips migrations outside production or when disabled", () => {
    expect(JSON.parse(run("scripts/vercel-build.mjs", ["--dry-run"], { VERCEL_ENV: "preview", KM_DB_URL: "mysql://pooled/db" }).stdout)).toMatchObject({ migrate: false });
    expect(JSON.parse(run("scripts/vercel-build.mjs", ["--dry-run"], { VERCEL_ENV: "production", KM_MIGRATE_ON_BUILD: "0", KM_DB_URL: "mysql://pooled/db" }).stdout)).toMatchObject({ migrate: false });
  });
  it("reports the application-URL fallback", () => {
    const out = JSON.parse(run("scripts/vercel-build.mjs", ["--dry-run"], { VERCEL_ENV: "production", KM_DB_URL: "mysql://pooled/db" }).stdout);
    expect(out).toMatchObject({ migrate: true, migrationUrlSource: "app" });
  });
  it("ignores the build hook on Vercel and honors it elsewhere", () => {
    const onVercel = JSON.parse(run("scripts/vercel-build.mjs", ["--dry-run"], { VERCEL_ENV: "production", VERCEL: "1", KM_VERCEL_BUILD_SCRIPT: "/tmp/fake-build.mjs", KM_DB_URL: "mysql://pooled/db" }).stdout);
    expect(onVercel.buildScript).toBe("scripts/build.mjs");
    const local = JSON.parse(run("scripts/vercel-build.mjs", ["--dry-run"], { VERCEL_ENV: "preview", KM_VERCEL_BUILD_SCRIPT: "/tmp/fake-build.mjs" }).stdout);
    expect(local.buildScript).toBe("/tmp/fake-build.mjs");
  });
  it("fails when production migration has no URL", () => {
    expect(run("scripts/vercel-build.mjs", ["--dry-run"], { VERCEL_ENV: "production" }).status).toBe(1);
  });
});

describe("vercel.json", () => {
  it("builds through the migration-aware script and targets the database region", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8"));
    expect(config).toMatchObject({
      framework: "nextjs",
      installCommand: "npm ci",
      buildCommand: "node scripts/vercel-build.mjs",
      ignoreCommand: "node scripts/vercel-ignore.mjs",
      skipMiddlewareRequestBody: true,
      regions: ["iad1"],
    });
  });
});

describe("upload exclusions", () => {
  it("keeps credentials, dumps, and local tooling out of Vercel uploads and git", () => {
    const vercelIgnore = readFileSync(".vercelignore", "utf8").split(/\r?\n/);
    for (const pattern of [
      ".env", ".env.*", "*.sql",
      ".opencode", ".playwright-mcp", ".cache", "coverage", "blob-report", "*.log", ".DS_Store", "docs/ui-comparisons",
    ]) {
      expect(vercelIgnore).toContain(pattern);
    }
    expect(readFileSync(".gitignore", "utf8").split(/\r?\n/)).toContain("*.sql");
  });
});

describe("vercel-build.mjs ordering", () => {
  it.skipIf(process.platform === "win32")("builds before migrating and never migrates after a failed build", () => {
    const dir = mkdtempSync(join(tmpdir(), "km-vercel-build-"));
    const build = join(dir, "build.mjs");
    const npm = join(dir, "npm");
    try {
      writeFileSync(build, 'console.log("BUILD"); process.exit(0);\n');
      writeFileSync(npm, '#!/bin/sh\necho MIGRATE\nexit 0\n');
      chmodSync(npm, 0o755);
      const env = {
        ...process.env,
        PATH: `${dir}:${process.env.PATH ?? ""}`,
        VERCEL_ENV: "production",
        KM_MIGRATE_ON_BUILD: "1",
        KM_DB_MIGRATE_URL: "mysql://direct/db",
        KM_VERCEL_BUILD_SCRIPT: build,
      };
      const ok = spawnSync(process.execPath, ["scripts/vercel-build.mjs"], { encoding: "utf8", env });
      expect(ok.status).toBe(0);
      expect(ok.stdout).toContain("BUILD");
      expect(ok.stdout.indexOf("MIGRATE")).toBeGreaterThan(ok.stdout.indexOf("BUILD"));

      const fallbackEnv: Record<string, string | undefined> = { ...env, KM_DB_URL: "mysql://pooled/db" };
      delete fallbackEnv.KM_DB_MIGRATE_URL;
      const fallback = spawnSync(process.execPath, ["scripts/vercel-build.mjs"], { encoding: "utf8", env: fallbackEnv as NodeJS.ProcessEnv });
      expect(fallback.status).toBe(0);
      expect(fallback.stderr).toContain("falling back");

      writeFileSync(build, 'console.log("BUILD"); process.exit(3);\n');
      const failed = spawnSync(process.execPath, ["scripts/vercel-build.mjs"], { encoding: "utf8", env });
      expect(failed.status).toBe(3);
      expect(failed.stdout).not.toContain("MIGRATE");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
