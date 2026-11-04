// Packs tools/knowledge-hub into public/cli/knowledge-hub.tgz, the CLI the Hub serves at
// /cli/knowledge-hub.tgz (task knowledge export design, Amendment 2). Runs before `next dev` and
// `next build`; an optional argument names another output directory (tests).
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(process.argv[2] ?? path.join(root, "public", "cli"));
const staging = path.join(out, ".pack");

rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
const packed = spawnSync("npm", ["pack", "--silent", "--pack-destination", staging], {
  cwd: path.join(root, "tools", "knowledge-hub"),
  stdio: ["ignore", "ignore", "inherit"],
  shell: process.platform === "win32",
});
if (packed.status !== 0) {
  console.error(`npm pack of tools/knowledge-hub failed (${packed.error?.message ?? `exit ${packed.status}`}).`);
  process.exit(1);
}
const [tarball] = readdirSync(staging).filter((name) => name.endsWith(".tgz"));
renameSync(path.join(staging, tarball), path.join(out, "knowledge-hub.tgz"));
rmSync(staging, { recursive: true, force: true });
