import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
    expect(JSON.parse(result.stdout)).toEqual({ build: true, migrate: true, migrationUrlSource: "direct" });
  });
  it("skips migrations outside production or when disabled", () => {
    expect(JSON.parse(run("scripts/vercel-build.mjs", ["--dry-run"], { VERCEL_ENV: "preview", KM_DB_URL: "mysql://pooled/db" }).stdout)).toMatchObject({ migrate: false });
    expect(JSON.parse(run("scripts/vercel-build.mjs", ["--dry-run"], { VERCEL_ENV: "production", KM_MIGRATE_ON_BUILD: "0", KM_DB_URL: "mysql://pooled/db" }).stdout)).toMatchObject({ migrate: false });
  });
  it("fails when production migration has no URL", () => {
    expect(run("scripts/vercel-build.mjs", ["--dry-run"], { VERCEL_ENV: "production" }).status).toBe(1);
  });
});

describe("vercel.json", () => {
  it("builds through the migration-aware script and targets sin1", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8"));
    expect(config).toMatchObject({
      framework: "nextjs",
      installCommand: "npm ci",
      buildCommand: "node scripts/vercel-build.mjs",
      ignoreCommand: "node scripts/vercel-ignore.mjs",
      regions: ["sin1"],
    });
  });
});
