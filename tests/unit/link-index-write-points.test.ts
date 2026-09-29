import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Graph spec §7.3 and §15. The link index is only as good as its coverage: a
 * path that writes a revision without replacing the document's edges leaves the
 * index describing a revision that is no longer current. That is detected
 * (the row is stale, and the UI says so) rather than silently wrong — but it is
 * still a defect, and nothing else would catch a fifth writer being added.
 *
 * So: every source file that inserts a revision must also replace the
 * document's links. `scripts/` is not included; the dev seed runs the repair
 * script at its end instead.
 */
function filesUnder(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const full = path.join(root, name);
    if (statSync(full).isDirectory()) return filesUnder(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("revision writers and the link index", () => {
  const writers = filesUnder("src")
    .filter((file) => !file.includes(`${path.sep}infrastructure${path.sep}`))
    .filter((file) => /\.revisions\.insert\(/.test(readFileSync(file, "utf8")));

  it("finds the four writers this was written against", () => {
    expect(writers.map((file) => path.basename(file)).sort()).toEqual([
      "create-document.ts",
      "create-revision.ts",
      "source-knowledge-projection-service.ts",
    ]);
  });

  it("has each of them replace the document's links, once per revision insert", () => {
    for (const file of writers) {
      const source = readFileSync(file, "utf8");
      const inserts = source.match(/\.revisions\.insert\(/g)?.length ?? 0;
      const replacements = source.match(/\.links\.replaceForDocument\(/g)?.length ?? 0;
      expect(replacements, `${file}: ${inserts} revision inserts, ${replacements} link replacements`).toBe(inserts);
    }
  });
});
