import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const SOURCES_MESSAGE = "Task knowledge must reach Sources through its lookup ports";

async function restrictedImports(code: string, filePath = "src/modules/task-knowledge/application/probe.ts") {
  const [result] = await new ESLint().lintText(code, { filePath });
  return result.messages.filter((message) => message.ruleId === "no-restricted-imports");
}

describe("task-knowledge module boundary", () => {
  it.each(["mariadb", "@/infrastructure/database/mariadb/pool", "next/server", "react", "@/server/composition"])(
    "reports an import of %s",
    async (specifier) => {
      // A path can match more than one group (`…/mariadb/pool` is both infrastructure and mariadb).
      expect((await restrictedImports(`import "${specifier}";`)).length).toBeGreaterThan(0);
    },
  );

  it("reports the sources domain with the task-knowledge message", async () => {
    const [message] = await restrictedImports('import { normalizeImportPath } from "@/modules/sources/domain/import-path";');
    expect(message?.message).toContain(SOURCES_MESSAGE);
  });

  it("reports a relative climb into sources from application/internal", async () => {
    const [message] = await restrictedImports(
      'import { normalizeImportPath } from "../../../sources/domain/import-path";',
      "src/modules/task-knowledge/application/internal/x.ts",
    );
    expect(message?.message).toContain(SOURCES_MESSAGE);
  });

  it("allows its own lookup ports", async () => {
    expect(await restrictedImports('import type { TaskSourceLookup } from "@/modules/task-knowledge/ports/lookups";')).toEqual([]);
  });
});
