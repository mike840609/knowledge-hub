#!/usr/bin/env node
import { configure, UsageError } from "../src/configure.mjs";
import { runExport } from "../src/export.mjs";
import { installAgent } from "../src/install-agent.mjs";

const BOOLEAN = new Set(["new", "allow-insecure-localhost", "claude", "opencode", "force"]);

/** `--name value` and `--flag`; anything else is a usage error. */
function parse(args) {
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) throw new UsageError(`Unexpected argument: ${arg.length > 40 ? `${arg.slice(0, 8)}…` : arg}`);
    const name = arg.slice(2);
    if (BOOLEAN.has(name)) flags[name] = true;
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
  configure [--hub-url <url>] [--binding-id <id>] [--profile <name>] [--allow-insecure-localhost]
  configure --rotate <bindingId>
  export --new | --retry <taskId> | --task <taskId> | --discard <taskId>  [--profile <name>]
  install-agent [--claude] [--opencode] [--force]`;

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (command === "configure") return await configure(parse(rest));
    if (command === "export") return await runExport(parse(rest));
    if (command === "install-agent") return installAgent(parse(rest));
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
