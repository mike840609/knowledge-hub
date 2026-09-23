import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Share-link spec §6.1 and the CLAUDE.md exception: readShared is the only
 * method that returns document content without a caller. Any other public
 * method of a knowledge application service that touches revision content
 * must take a CallerContext.
 */
describe("the share link is the single caller-less content path", () => {
  const root = "src/modules/knowledge/application";
  const files = readdirSync(root).filter((name) => name.endsWith(".ts")).map((name) => path.join(root, name));

  it("finds readShared and nothing else", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/^ {2}async (\w+)\(([^)]*)\)/gm)) {
        const [, name, parameters] = match;
        if (parameters.includes("caller")) continue;
        const start = match.index ?? 0;
        const end = source.indexOf("\n  }\n", start);
        if (/markdown/.test(source.slice(start, end === -1 ? undefined : end))) offenders.push(`${path.basename(file)}#${name}`);
      }
    }
    expect(offenders).toEqual(["document-share-service.ts#readShared"]);
  });
});
