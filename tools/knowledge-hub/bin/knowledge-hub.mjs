#!/usr/bin/env node
import { configure, status, UsageError } from "../src/configure.mjs";
import { runExport } from "../src/export.mjs";
import { installAgent } from "../src/install-agent.mjs";
import { runRead, runSearch } from "../src/read.mjs";

const BOOLEAN = new Set(["new", "allow-insecure-localhost", "claude", "opencode", "force"]);
// `--task` is a value flag on export and a boolean on read.
const BOOLEAN_BY_COMMAND = { search: new Set(["tasks"]), read: new Set(["task"]) };

/** `--name value` and `--flag`; positional words only where a command takes them. */
function parse(args, command, positionals) {
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      if (!positionals) throw new UsageError(`Unexpected argument: ${arg.length > 40 ? `${arg.slice(0, 8)}…` : arg}`);
      positionals.push(arg);
      continue;
    }
    const name = arg.slice(2);
    // `--token=<secret>` must not come back in an error message.
    if (name.includes("=")) throw new UsageError("Write flags as --name value, not --name=value.");
    if (BOOLEAN.has(name) || BOOLEAN_BY_COMMAND[command]?.has(name)) flags[name] = true;
    else {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) throw new UsageError(`--${name} needs a value.`);
      flags[name] = value;
      index += 1;
    }
  }
  return flags;
}

const HELP = `knowledge-hub <command>
  configure [--hub-url <url>] [--binding-id <id>] [--token <token>] [--profile <name>] [--allow-insecure-localhost]
  configure --rotate <bindingId> [--token <token>]
  export --new | --retry <taskId> | --task <taskId> | --discard <taskId>  [--profile <name> | --profile-b64 <encoded>]
  search <words> [--tasks] [--profile <name>]
  read <path | documentId | taskResultId> [--task] [--profile <name>]
  status [--profile <name>]
  install-agent [--claude] [--opencode] [--force]`;

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (command === "configure") return await configure(parse(rest, command));
    if (command === "export") return await runExport(parse(rest, command));
    if (command === "search") {
      const words = [];
      const flags = parse(rest, command, words);
      if (words.length === 0) throw new UsageError("Use: knowledge-hub search <words> [--tasks] [--profile <name>]");
      return await runSearch(flags, words);
    }
    if (command === "read") {
      const refs = [];
      const flags = parse(rest, command, refs);
      if (refs.length !== 1) throw new UsageError("Use: knowledge-hub read <path | documentId | taskResultId> [--task] [--profile <name>]");
      return await runRead(flags, refs[0]);
    }
    if (command === "status") return status(parse(rest, command));
    if (command === "install-agent") return installAgent(parse(rest, command));
    console.log(HELP);
    return command === undefined || command === "help" || command === "--help" ? 0 : 2;
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      return 2;
    }
    console.error(`knowledge-hub failed: ${error instanceof Error ? error.name : "unknown error"}`);
    return 2;
  }
}

process.exitCode = await main();
