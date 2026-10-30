import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Team-space publishing spec, "When the team updates". An unconsumed
 * publication event is how the team learns that a personal original changed:
 * an event missing from a writer's transaction is invisible — the team simply
 * never updates — while a duplicate is harmless (consumption is idempotent and
 * reconciles the original's current state, not the event payload).
 *
 * So every writer of a personal original's content, placement or lifecycle has
 * to record one, in the same transaction. Nothing else would catch a sixth
 * writer being added, and a rename writes no revision at all, so scanning the
 * revision writers alone is not enough.
 */
function filesUnder(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const full = path.join(root, name);
    if (statSync(full).isDirectory()) return filesUnder(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

function read(file: string): string {
  return readFileSync(file, "utf8");
}

function names(files: readonly string[]): string[] {
  return files.map((file) => path.basename(file)).sort();
}

/** A writer records through the port directly or through the personal-original helper. */
const RECORDS = /(publicationEvents\.record(Many)?|recordPersonalPublicationEvent|recordManyPersonalPublicationEvents)\(/;

/** The team publication writer is the one writer that must never record a personal event. */
const TEAM_PUBLICATION_WRITER = "publication-write-authority.ts";

const moduleFiles = [...filesUnder("src/modules/knowledge"), ...filesUnder("src/modules/sources")];

describe("revision writers record a publication event", () => {
  const writers = filesUnder("src")
    .filter((file) => !file.includes(`${path.sep}infrastructure${path.sep}`))
    .filter((file) => /\.revisions\.insert(Many)?\(/.test(read(file)));

  it("finds the writers this was written against", () => {
    expect(names(writers)).toEqual([
      "create-document.ts",
      "create-revision.ts",
      "publication-write-authority.ts",
      "source-knowledge-projection-service.ts",
    ]);
  });

  it("records one event per revision insert, in the writer's own transaction", () => {
    for (const file of writers) {
      const source = read(file);
      if (path.basename(file) === TEAM_PUBLICATION_WRITER) continue;
      expect(source, `${file}: revision insert without a publication event`).toMatch(RECORDS);
    }
  });

  it("records a bulk revision insert with recordMany, once per insert", () => {
    const source = read(path.join("src/modules/sources/application", "source-knowledge-projection-service.ts"));
    const bulkInserts = source.match(/\.revisions\.insertMany\(/g)?.length ?? 0;
    const bulkEvents = source.match(/recordManyPersonalPublicationEvents\(|publicationEvents\.recordMany\(/g)?.length ?? 0;
    expect(bulkEvents, `${bulkInserts} bulk revision inserts, ${bulkEvents} bulk event calls`).toBe(bulkInserts);
  });

  it("never records from the team publication writer", () => {
    const file = path.join("src/modules/sources/application", TEAM_PUBLICATION_WRITER);
    const source = read(file);
    expect(source).toMatch(/\.revisions\.insert\(/);
    expect(source).not.toMatch(RECORDS);
    expect(source).not.toContain("publicationEvents");
  });
});

describe("tree, document and lifecycle writers record a publication event", () => {
  const writers = moduleFiles
    .filter((file) => path.basename(file) !== TEAM_PUBLICATION_WRITER)
    .filter((file) =>
      /tree\.(updateParent|updateName|updateStatus|updateStatusForDocument)\(|documents\.updateStatus\(/.test(read(file)));

  it("finds the writers this was written against", () => {
    expect(names(writers)).toEqual([
      "move-tree-node.ts",
      "rename-folder.ts",
      "set-document-lifecycle.ts",
      "set-folder-lifecycle.ts",
      "source-knowledge-projection-service.ts",
    ]);
  });

  it("records in every one of them", () => {
    for (const file of writers) {
      expect(read(file), `${file}: tree/lifecycle write without a publication event`).toMatch(RECORDS);
    }
  });

  it("never records from the team publication writer's own tree and status writes", () => {
    const source = read(path.join("src/modules/sources/application", TEAM_PUBLICATION_WRITER));
    expect(source).toMatch(/tree\.updateParent\(|tree\.updateStatus\(/);
    expect(source).not.toMatch(RECORDS);
  });
});

describe("sources-side originals record a publication event", () => {
  const entryWriters = moduleFiles.filter((file) => /entries\.update\(|entries\.insertMany\(/.test(read(file)));

  it("finds the writers this was written against", () => {
    expect(names(entryWriters)).toEqual([
      "source-entry-mapping-service.ts",
      "source-import-plan-executor.ts",
      "source-knowledge-projection-service.ts",
      "source-version-guard.ts",
    ]);
  });

  it("records a path or lifecycle change outside the covered entry helpers", () => {
    // `source-entry-mapping-service.ts` is the entry-level primitive set. Its
    // writes are called only from commands that record for the enclosing
    // document/folder (pinned by the next test), so it must not add a second
    // event for the same action.
    for (const file of entryWriters) {
      if (path.basename(file) === "source-entry-mapping-service.ts") continue;
      expect(read(file), `${file}: entry write without a publication event`).toMatch(RECORDS);
    }
  });

  it("only calls the entry helpers from files that record", () => {
    const callers = moduleFiles
      .filter((file) => path.basename(file) !== "source-entry-mapping-service.ts")
      .filter((file) => /(archiveSourceEntry|restoreSourceEntry|updateSourceLocator|createSourceEntryMapping)\(/.test(read(file)));
    expect(names(callers)).toEqual(["source-knowledge-projection-service.ts", "source-version-guard.ts"]);
    for (const file of callers) {
      expect(read(file), `${file}: calls a SourceEntry helper without recording`).toMatch(RECORDS);
    }
  });

  it("records a whole-source archive and restore", () => {
    const lifecycleWriters = moduleFiles.filter((file) => /sources\.updateStatus\(/.test(read(file)));
    expect(names(lifecycleWriters)).toEqual(["source-version-guard.ts"]);
    for (const file of lifecycleWriters) {
      expect(read(file), `${file}: source lifecycle write without a publication event`).toMatch(RECORDS);
    }
  });
});
