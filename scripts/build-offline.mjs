import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const build = fileURLToPath(new URL("./build.mjs", import.meta.url));
let command;
let args;
if (process.platform === "darwin") {
  command = "/usr/bin/sandbox-exec";
  args = ["-p", "(version 1)(allow default)(deny network*)", process.execPath, build];
} else if (process.platform === "linux") {
  command = process.getuid() === 0 ? "unshare" : "sudo";
  args = process.getuid() === 0
    ? ["--net", "--", process.execPath, build]
    : ["-n", "unshare", "--net", "--", process.execPath, build];
} else {
  throw new Error("Offline build isolation supports macOS and Linux. Use a Linux environment with unshare on other platforms.");
}

// A clean output directory prevents a previous build from masking missing assets.
await rm(new URL("../.next/", import.meta.url), { recursive: true, force: true });
console.log("Building with OS-enforced network isolation (dependencies must already be installed).");
const child = spawn(command, args, {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
});
child.on("error", (error) => { console.error(error); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
