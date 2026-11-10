import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Agent read access design §4: no route under `src/app/api/agent/**` takes a
 * Workspace ID from the request. The Workspace comes from the export
 * credential's binding alone; `src/server/agent-read.ts` is the only place that
 * may name it, and it does so from `authorize`, never from a request.
 *
 * The check is plain text because the routes never need the word: the two
 * helpers in `src/server/agent-read.ts` carry the value as `space`.
 */

const ROUTES = path.join(process.cwd(), "src/app/api/agent");

function filesUnder(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const full = path.join(root, name);
    if (statSync(full).isDirectory()) return filesUnder(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

/** Block comments and whole-line comments; string contents are left alone. */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const sources = filesUnder(ROUTES).map((file) => ({
  file: path.relative(process.cwd(), file).split(path.sep).join("/"),
  source: stripComments(readFileSync(file, "utf8")),
}));

describe("no agent route names a Workspace ID", () => {
  it("scans the three route files", () => {
    expect(sources.map(({ file }) => file).sort()).toEqual([
      "src/app/api/agent/documents/route.ts",
      "src/app/api/agent/search/route.ts",
      "src/app/api/agent/tasks/route.ts",
    ]);
  });

  it("never spells workspaceId or workspace_id", () => {
    const violations = sources.filter(({ source }) => /workspaceId/i.test(source) || /workspace_id/i.test(source));
    expect(violations.map(({ file }) => file)).toEqual([]);
  });

  it("ignores comments that discuss the rule", () => {
    expect(stripComments('// workspaceId comes from the binding\nconst x = "space";')).not.toMatch(/workspaceId/i);
    expect(stripComments("/* workspace_id */ const x = 1;")).not.toMatch(/workspace_id/i);
  });
});
