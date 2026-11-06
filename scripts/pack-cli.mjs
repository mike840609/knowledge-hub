// Packs tools/knowledge-hub into public/cli/knowledge-hub.tgz, the CLI the Hub serves at
// /cli/knowledge-hub.tgz (task knowledge export design, Amendment 2). Runs before `next dev` and
// `next build`; an optional argument names another output directory (tests).
// ponytail: packed once per start, so a running `next dev` serves the CLI as it was at start; restart to pick up edits.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(process.argv[2] ?? path.join(root, "public", "cli"));
mkdirSync(out, { recursive: true });
// One staging directory per run, so two dev servers starting together do not clear each other's.
const staging = mkdtempSync(path.join(out, ".pack-"));

function fail(message) {
  rmSync(staging, { recursive: true, force: true });
  console.error(`Packing tools/knowledge-hub failed: ${message}`);
  process.exit(1);
}

const cwd = path.join(root, "tools", "knowledge-hub");
const options = { cwd, stdio: ["ignore", "ignore", "inherit"] };
// Windows runs npm.cmd only through a shell, which does not quote arguments: pass one quoted command line.
const packed = process.platform === "win32"
  ? spawnSync(`npm pack --silent --pack-destination "${staging}"`, { ...options, shell: true })
  : spawnSync("npm", ["pack", "--silent", "--pack-destination", staging], options);
if (packed.status !== 0) fail(packed.error?.message ?? `npm pack exited ${packed.status}`);

const tarball = readdirSync(staging).find((name) => name.endsWith(".tgz"));
if (!tarball) fail("npm pack wrote no .tgz");
// rename is atomic within a directory, so a concurrent reader sees the old or the new tarball, never half of one.
renameSync(path.join(staging, tarball), path.join(out, "knowledge-hub.tgz"));
rmSync(staging, { recursive: true, force: true });
