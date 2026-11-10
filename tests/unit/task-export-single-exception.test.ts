import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Agent read access design §3: `IngestTaskResultService.ingest` and
 * `AgentReadAccessService.authorize` are the only task-knowledge entries
 * without a `CallerContext`; their authority is the export credential. Three
 * facts keep them the only ones:
 *
 * - every public entry directly in `application/` takes a `CallerContext`,
 *   except `ingest` and `authorize`;
 * - only the ingest route calls `.ingest(` from the web layer;
 * - `.authorize(` is called from the web layer only in `src/app/api/agent/`
 *   and `src/server/agent-read.ts`;
 * - caller-less helpers under `application/internal/` are imported only from
 *   files directly in `application/`, so the web layer cannot reach one
 *   around the caller rule.
 */

const SRC = path.join(process.cwd(), "src");
const APPLICATION = "src/modules/task-knowledge/application";
const INTERNAL = `${APPLICATION}/internal/`;

function filesUnder(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const full = path.join(root, name);
    if (statSync(full).isDirectory()) return filesUnder(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

const relative = (file: string) => path.relative(process.cwd(), file).split(path.sep).join("/");

/** Block comments and whole-line comments; string contents are left alone. */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** The text between the bracket at `open` and its match. */
function enclosed(source: string, open: number): string {
  const pairs: Record<string, string> = { "(": ")", "{": "}" };
  const opener = source[open];
  const closer = pairs[opener];
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === opener) depth += 1;
    if (source[index] === closer) {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  return source.slice(open + 1);
}

/** Top-level members of a class body: each ends at a depth-zero `;` or at the `}` that closes its own body. */
function classMembers(body: string): string[] {
  const members: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if ("({[".includes(char)) depth += 1;
    if (")}]".includes(char)) {
      depth -= 1;
      if (depth === 0 && char === "}") {
        members.push(body.slice(start, index + 1).trim());
        start = index + 1;
      }
    }
    if (char === ";" && depth === 0) {
      members.push(body.slice(start, index + 1).trim());
      start = index + 1;
    }
  }
  return members.filter(Boolean);
}

type Entry = { name: string; parameters: string };

function entriesOf(source: string): { entries: Entry[]; arrowMembers: string[] } {
  const text = stripComments(source);
  const entries: Entry[] = [];
  const arrowMembers: string[] = [];
  for (const match of text.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)\s*(?:<[^>(]*>)?\(/gm)) {
    entries.push({ name: match[1], parameters: enclosed(text, (match.index ?? 0) + match[0].length - 1) });
  }
  for (const match of text.matchAll(/^export\s+class\s+(\w+)[^{]*\{/gm)) {
    const className = match[1];
    for (const member of classMembers(enclosed(text, (match.index ?? 0) + match[0].length - 1))) {
      if (/^(?:private|protected)\b|^#/.test(member)) continue;
      const head = member.split("{")[0];
      if (/=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*(?::[^=]+)?=>/.test(head)) {
        arrowMembers.push(`${className}.${member.slice(0, 40)}`);
        continue;
      }
      const method = /^(?:public\s+)?(?:static\s+)?(?:async\s+)?(\w+)\s*(?:<[^>(]*>)?\(/.exec(member);
      if (!method || method[1] === "constructor") continue;
      entries.push({ name: `${className}.${method[1]}`, parameters: enclosed(member, method[0].length - 1) });
    }
  }
  return { entries, arrowMembers };
}

const IMPORT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;

/** Every file that imports something under `application/internal/` without itself sitting directly in `application/`. */
function internalHelperViolations(files: { file: string; source: string }[]): string[] {
  const violations: string[] = [];
  for (const { file, source } of files) {
    for (const match of source.matchAll(IMPORT_SPECIFIER)) {
      const specifier = match[1];
      const resolved = specifier.startsWith("@/")
        ? `src/${specifier.slice(2)}`
        : specifier.startsWith(".")
          ? path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier))
          : null;
      if (!resolved || !`${resolved}/`.startsWith(INTERNAL) && !resolved.startsWith(INTERNAL)) continue;
      if (path.posix.dirname(file) !== APPLICATION) violations.push(`${file} -> ${specifier}`);
    }
  }
  return violations;
}

const applicationFiles = readdirSync(path.join(process.cwd(), APPLICATION))
  .filter((name) => /\.tsx?$/.test(name))
  .map((name) => path.join(process.cwd(), APPLICATION, name));

describe("the one caller-less task-knowledge write", () => {
  const scanned = applicationFiles.map((file) => ({ file: relative(file), ...entriesOf(readFileSync(file, "utf8")) }));

  it("declares no public entry as an arrow-function property", () => {
    expect(scanned.flatMap((item) => item.arrowMembers)).toEqual([]);
  });

  it("gives every public entry a CallerContext except ingest and authorize", () => {
    const callerLess = scanned.flatMap((item) => item.entries.filter((entry) => !/:\s*CallerContext\b/.test(entry.parameters)).map((entry) => entry.name));
    expect(callerLess).toEqual(["AgentReadAccessService.authorize", "IngestTaskResultService.ingest"]);
  });

  it("is called from the web layer only by the ingest route", () => {
    const callers = ["server", "app", "components"]
      .flatMap((dir) => filesUnder(path.join(SRC, dir)))
      .filter((file) => /\.ingest\(/.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(SRC, file).split(path.sep).join("/"));
    expect(callers).toEqual(["app/api/task-results/ingest/route.ts"]);
  });

  it("is called from the web layer only by the agent read entry points", () => {
    const callers = ["server", "app", "components"]
      .flatMap((dir) => filesUnder(path.join(SRC, dir)))
      .filter((file) => /\.authorize\(/.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(SRC, file).split(path.sep).join("/"));
    const outside = callers.filter((file) => !file.startsWith("app/api/agent/") && file !== "server/agent-read.ts");
    expect(outside).toEqual([]);
  });

  it("keeps the agent read helpers inside the agent routes and their definitions", () => {
    const webFiles = ["server", "app", "components"].flatMap((dir) => filesUnder(path.join(SRC, dir)));
    const callers = (pattern: RegExp) => webFiles
      .filter((file) => pattern.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(SRC, file).split(path.sep).join("/"));
    const outside = (pattern: RegExp, allowed: string[]) =>
      callers(pattern).filter((file) => !file.startsWith("app/api/agent/") && !allowed.includes(file));

    // agent-read.ts defines agentScope and is the one caller of agentReadServices;
    // composition.ts defines agentReadServices.
    expect(outside(/\bagentScope\(/, ["server/agent-read.ts"])).toEqual([]);
    expect(outside(/\bagentReadServices\(/, ["server/agent-read.ts", "server/composition.ts"])).toEqual([]);
  });

  it("keeps internal helpers reachable only from application/", () => {
    const files = filesUnder(SRC).map((file) => ({ file: relative(file), source: readFileSync(file, "utf8") }));
    expect(internalHelperViolations(files)).toEqual([]);
  });

  it("resolves relative and aliased specifiers before judging them", () => {
    expect(
      internalHelperViolations([
        { file: "src/modules/task-knowledge/ports/x.ts", source: 'import { y } from "../application/internal/y";' },
        { file: "src/server/a.ts", source: 'import { y } from "@/modules/task-knowledge/application/internal/y";' },
        { file: "src/modules/task-knowledge/application/internal/z.ts", source: 'import { y } from "./y";' },
        { file: `${APPLICATION}/ingest.ts`, source: 'import { y } from "./internal/y";' },
      ]),
    ).toEqual([
      'src/modules/task-knowledge/ports/x.ts -> ../application/internal/y',
      "src/server/a.ts -> @/modules/task-knowledge/application/internal/y",
      "src/modules/task-knowledge/application/internal/z.ts -> ./y",
    ]);
  });

  it("finds methods by braces and fails an arrow-function member", () => {
    const { entries, arrowMembers } = entriesOf(`
export class Probe {
  constructor(private readonly x: number) {}
  async read(caller: CallerContext, id: string) { if (id) { return { a: 1 }; } return null; }
    oddlyIndented(id: string) { return id; }
  private hidden(id: string) { return id; }
  sneaky = async (id: string) => id;
}
export function helper(caller: CallerContext) { return caller; }`);
    expect(entries.map((entry) => entry.name)).toEqual(["helper", "Probe.read", "Probe.oddlyIndented"]);
    expect(arrowMembers).toHaveLength(1);
  });
});
