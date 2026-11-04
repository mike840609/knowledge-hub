import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { migrations } from "@/infrastructure/database/mariadb/migrations";

// `version` is schema_migrations' primary key: two branches that each add "the next" migration collide here.
const DIR = path.join(process.cwd(), "src/infrastructure/database/mariadb/migrations");
const files = readdirSync(DIR).filter((name) => /^\d{3}-.+\.ts$/.test(name));

describe("migrations", () => {
  it("have unique versions in strictly increasing order", () => {
    const versions = migrations.map((migration) => migration.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("register one migration per file, under the version its file name carries", () => {
    expect(migrations.map((migration) => migration.version).sort((a, b) => a - b)).toEqual(files.map((file) => Number(file.slice(0, 3))).sort((a, b) => a - b));
  });
});
