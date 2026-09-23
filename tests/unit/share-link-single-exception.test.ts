import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Share-link spec §6.1 and the CLAUDE.md exception: readShared is the only
 * path that returns document content without a caller. Two layers can serve
 * content, so both are checked:
 *
 * - the knowledge application services, where content is read: every public
 *   method or exported function that touches revisions or Markdown must take
 *   a `CallerContext`-typed parameter, except readShared;
 * - the web layer (src/server, src/app, src/components), which reaches
 *   content only through those services: nothing there may read revision
 *   repositories directly, and only the /s/:token projection may call the
 *   caller-less entry.
 */

function filesUnder(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const full = path.join(root, name);
    if (statSync(full).isDirectory()) return filesUnder(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

/** The text between a `(` at `open` and its matching `)`. */
function parenthesised(source: string, open: number): string {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "(") depth += 1;
    if (source[index] === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  return source.slice(open + 1);
}

type Callable = { file: string; name: string; parameters: string; body: string };

/** Public class methods (two-space indent) and exported functions, async or not. */
function callables(file: string): Callable[] {
  const source = readFileSync(file, "utf8");
  const found: Callable[] = [];
  const pattern = /^(?: {2}(?:public\s+)?(?:static\s+)?(?:async\s+)?|export\s+(?:async\s+)?function\s+)(\w+)\s*(?:<[^>(]*>)?\(/gm;
  for (const match of source.matchAll(pattern)) {
    const name = match[1];
    if (["constructor", "if", "for", "while", "switch", "catch", "return"].includes(name)) continue;
    const open = (match.index ?? 0) + match[0].length - 1;
    const parameters = parenthesised(source, open);
    const bodyStart = open + parameters.length + 2;
    const nextMember = source.slice(bodyStart).search(/\n {2}(?:(?:public|private|static|async)\s+)*\w+\s*(?:<[^>(]*>)?\(|\nexport\s|\n}\n/);
    const body = source.slice(bodyStart, nextMember === -1 ? undefined : bodyStart + nextMember);
    found.push({ file: path.relative(process.cwd(), file), name, parameters, body });
  }
  return found;
}

const readsContent = (body: string) => /\bmarkdown\b|\.revisions\.|\brevision\.(title|markdown)\b/.test(body);

describe("the share link is the single caller-less content path", () => {
  it("every knowledge application entry that reads content takes a CallerContext, except readShared", () => {
    const offenders = filesUnder("src/modules/knowledge/application")
      .flatMap(callables)
      .filter((callable) => readsContent(callable.body) && !/:\s*CallerContext\b/.test(callable.parameters))
      .map((callable) => `${path.basename(callable.file)}#${callable.name}`);
    expect(offenders).toEqual(["document-share-service.ts#readShared"]);
  });

  it("the web layer never reads revision repositories directly", () => {
    const offenders = ["src/server", "src/app", "src/components"]
      .flatMap(filesUnder)
      .filter((file) => /\.revisions\.\w+\(/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("only the /s/:token projection reaches the caller-less entry", () => {
    const callers = ["src/server", "src/app", "src/components"]
      .flatMap(filesUnder)
      .filter((file) => !file.endsWith(path.join("server", "composition.ts")))
      .filter((file) => /\breadShared\s*\(|\bshareReadService\s*\(/.test(readFileSync(file, "utf8")));
    expect(callers).toEqual([path.join("src", "server", "share-read.ts")]);
  });
});
