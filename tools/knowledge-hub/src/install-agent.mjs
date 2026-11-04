import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UsageError } from "./configure.mjs";
import { userDirs, writePrivate } from "./project-config.mjs";
import { sha256 } from "./state.mjs";

const AGENT = fileURLToPath(new URL("../agent/", import.meta.url));

// Installed-file hashes, so a later install overwrites only what it wrote itself.
const recordFile = () => path.join(userDirs().config, "installed-agent.json");
const readRecord = () => (existsSync(recordFile()) ? JSON.parse(readFileSync(recordFile(), "utf8")) : {});

export function installAgent(flags) {
  const claudeOnly = flags.claude && !flags.opencode;
  const home = homedir();
  const skillPath = path.join(home, ".claude", "skills", "hub-export", "SKILL.md");
  // ponytail: OpenCode's user commands dir as of v2.1; confirm on new OpenCode releases.
  const opencodeDir = path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "opencode", "commands");
  const files = [[skillPath, readFileSync(path.join(AGENT, "hub-export", "SKILL.md"), "utf8")]];
  if (!claudeOnly) {
    const adapter = readFileSync(path.join(AGENT, "opencode", "hub-export.md"), "utf8").replaceAll("{{SKILL_PATH}}", skillPath);
    files.push([path.join(opencodeDir, "hub-export.md"), adapter]);
  }

  const record = readRecord();
  const blocked = files.filter(([file]) => existsSync(file) && record[file] !== sha256(readFileSync(file)));
  if (blocked.length > 0 && !flags.force) {
    throw new UsageError(`Not overwriting files changed or not installed by knowledge-hub:\n${blocked.map(([file]) => `  ${file}`).join("\n")}\nRun with --force to replace them.`);
  }
  for (const [file, text] of files) {
    writePrivate(file, text);
    record[file] = sha256(Buffer.from(text, "utf8"));
    console.log(`Installed ${file}`);
  }
  writePrivate(recordFile(), `${JSON.stringify(record, null, 2)}\n`);
  return 0;
}
