import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseTaskContent } from "@/modules/task-knowledge/domain/task-artifact";

const ROOT = process.cwd();
const AGENT = path.join(ROOT, "tools/knowledge-hub/agent");
const CLI = path.join(ROOT, "tools/knowledge-hub/bin/knowledge-hub.mjs");
const skill = () => readFileSync(path.join(AGENT, "hub-export/SKILL.md"), "utf8");
const adapter = () => readFileSync(path.join(AGENT, "opencode/hub-export.md"), "utf8");

function frontmatter(text: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) throw new Error("no frontmatter");
  return Object.fromEntries(match[1].split("\n").map((line) => {
    const at = line.indexOf(":");
    return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
  }));
}

describe("the shared hub-export Skill", () => {
  it("has frontmatter naming hub-export with a description", () => {
    const meta = frontmatter(skill());
    expect(meta.name).toBe("hub-export");
    expect(meta.description.length).toBeGreaterThan(20);
  });

  it("names every export command and the meaning of exit codes 2, 3 and 4", () => {
    const text = skill();
    for (const command of ["export --new", "export --task", "export --retry", "export --discard"]) expect(text).toContain(`knowledge-hub ${command}`);
    for (const code of ["2", "3", "4"]) expect(text).toMatch(new RegExp(`exit(?: code)? ${code}\\b`, "i"));
  });

  it("states the same-task rule after a refused --new", () => {
    const text = skill().toLowerCase();
    expect(text).toMatch(/run each .*--retry/);
    expect(text).toMatch(/if (?:one|a retry) fails.*stop/);
    expect(text).toMatch(/by meaning/);
    expect(text).toMatch(/not by (?:equal )?titles/);
    expect(text).toMatch(/ask the user/);
  });

  it("runs --discard only on the user's explicit request", () => {
    expect(skill().toLowerCase()).toMatch(/--discard[^\n]*only when the user explicitly asks/);
  });

  it("never asks the Agent to set a CLI-owned field", () => {
    for (const field of ["schemaVersion", "taskId", "artifactRevision", "bindingId"]) expect(skill()).not.toContain(field);
  });

  it("leaves completedAt to the command instead of guessing a time", () => {
    const text = skill();
    expect(text.toLowerCase()).toMatch(/leave out `completedat`[^\n]*the command sets[^\n]*current time/);
    expect(/```json\n([\s\S]*?)```/.exec(text)![1]).not.toContain("completedAt");
  });

  it("records verification from evidence only and references Wiki pages only when explicit", () => {
    const text = skill().toLowerCase();
    expect(text).toMatch(/never .*"passed".*without/);
    expect(text).toMatch(/wiki references? only .*explicit/);
  });

  it("forbids a whole-conversation upload, Stop/Idle hooks and MCP", () => {
    const text = skill().toLowerCase();
    expect(text).toMatch(/never .*whole conversation/);
    expect(text).toMatch(/stop or idle hook/);
    expect(text).toMatch(/no mcp/);
  });

  it("reports the Task ID and uses it to update the export just made", () => {
    const text = skill();
    expect(text).toMatch(/report .*Task ID/i);
    expect(text).toMatch(/update the export .*Task ID/i);
  });

  it("corrects its own content after an exit 2 without --retry hints", () => {
    expect(skill().toLowerCase()).toMatch(/exit 2[^\n]*without[^\n]*--retry[^\n]*correct/);
  });

  it("stops on an exit 2 that names configure or --discard instead of rewriting the content", () => {
    expect(skill().toLowerCase()).toMatch(/exit 2[^\n]*names[^\n]*configure[^\n]*--discard[^\n]*stop/);
  });

  it("after a refused --task, retries and runs the same --task again, never --new", () => {
    expect(skill().toLowerCase()).toMatch(/refused `?--task`?[^\n]*--retry[^\n]*same `?--task`?[^\n]*never[^\n]*--new/);
  });

  it("mentions no credential file, token or header", () => {
    for (const text of [skill(), adapter()]) {
      expect(text).not.toMatch(/x-knowledge-hub-export-token/i);
      expect(text).not.toMatch(/credentials?\//i);
      expect(text).not.toMatch(/\btoken\b/i);
    }
  });
});

describe("the OpenCode adapter", () => {
  it("delegates to the installed Skill and has no workflow of its own", () => {
    const text = adapter();
    expect(text).toContain("{{SKILL_PATH}}");
    expect(text).not.toContain("knowledge-hub export");
    expect(text).not.toMatch(/^\s*\d+\.\s/m);
  });
});

describe("the setup docs", () => {
  it.each(["docs/task-export-setup.md", "docs/task-export-setup.zh-TW.md"])("%s carries example content the server accepts", (doc) => {
    const text = readFileSync(path.join(ROOT, doc), "utf8");
    const block = /<!-- example-content -->\s*```json\n([\s\S]*?)```/.exec(text);
    expect(block).not.toBeNull();
    // What the CLI sends: the example plus the completion time it sets.
    expect(() => parseTaskContent({ completedAt: "2026-11-05T10:00:00Z", ...JSON.parse(block![1]) })).not.toThrow();
    for (const command of ["/cli/knowledge-hub.tgz", "configure --rotate", "export --retry", "install-agent"]) expect(text).toContain(command);
    expect(text).not.toContain("configure --from");
    expect(text).not.toContain("npm pack");
  });

  it.each(["docs/task-export-setup.md", "docs/task-export-setup.zh-TW.md"])("%s example content may leave completedAt to the CLI", (doc) => {
    const text = readFileSync(path.join(ROOT, doc), "utf8");
    const block = /<!-- example-content -->\s*```json\n([\s\S]*?)```/.exec(text);
    expect(JSON.parse(block![1])).not.toHaveProperty("completedAt");
  });
});

describe("knowledge-hub install-agent", () => {
  let home: string;
  beforeEach(() => { home = mkdtempSync(path.join(tmpdir(), "kh-agent-")); });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  const install = (...args: string[]) =>
    spawnSync(process.execPath, [CLI, "install-agent", ...args], { env: { NODE_ENV: "test", HOME: home, USERPROFILE: home, PATH: process.env.PATH ?? "" }, encoding: "utf8" });
  const names = ["hub-export", "hub-search", "hub-read"];
  const skillPath = (name = "hub-export") => path.join(home, `.claude/skills/${name}/SKILL.md`);
  const adapterPath = (name = "hub-export") => path.join(home, `.config/opencode/commands/${name}.md`);
  const source = (file: string) => readFileSync(path.join(AGENT, file), "utf8");

  it("writes the three Skills and their three adapters", () => {
    expect(install().status).toBe(0);
    for (const name of names) {
      expect(existsSync(skillPath(name))).toBe(true);
      expect(existsSync(adapterPath(name))).toBe(true);
    }
  });

  it("installs the Skill and the adapter, filling in the Skill's absolute path", () => {
    expect(install().status).toBe(0);
    for (const name of names) {
      expect(readFileSync(skillPath(name), "utf8")).toBe(source(`${name}/SKILL.md`));
      const installed = readFileSync(adapterPath(name), "utf8");
      expect(installed).toContain(skillPath(name));
      expect(installed).not.toContain("{{SKILL_PATH}}");
    }
  });

  it("installs only the Skills with --claude, and the Skills too with --opencode alone", () => {
    expect(install("--claude").status).toBe(0);
    for (const name of names) {
      expect(existsSync(skillPath(name))).toBe(true);
      expect(existsSync(adapterPath(name))).toBe(false);
    }
    rmSync(path.join(home, ".claude"), { recursive: true });
    expect(install("--opencode").status).toBe(0);
    for (const name of names) {
      expect(existsSync(skillPath(name))).toBe(true);
      expect(existsSync(adapterPath(name))).toBe(true);
    }
  });

  it("is idempotent", () => {
    expect(install().status).toBe(0);
    expect(install().status).toBe(0);
    for (const name of names) expect(readFileSync(skillPath(name), "utf8")).toBe(source(`${name}/SKILL.md`));
  });

  it("refuses to overwrite a file the user changed, unless --force", () => {
    expect(install().status).toBe(0);
    writeFileSync(skillPath(), "my own edits\n");
    const refused = install();
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain(skillPath());
    expect(readFileSync(skillPath(), "utf8")).toBe("my own edits\n");
    expect(install("--force").status).toBe(0);
    expect(readFileSync(skillPath(), "utf8")).toBe(skill());
  });

  it("refuses to overwrite a same-named file it never installed", () => {
    expect(install("--claude").status).toBe(0);
    rmSync(path.join(home, ".local"), { recursive: true, force: true });
    rmSync(path.join(home, ".config/knowledge-hub"), { recursive: true, force: true });
    writeFileSync(skillPath(), "someone else's skill\n");
    expect(install().status).toBe(2);
    expect(readFileSync(skillPath(), "utf8")).toBe("someone else's skill\n");
  });
});
