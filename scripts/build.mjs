import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
// The CLI the Hub serves at /cli/knowledge-hub.tgz is packed from this checkout first.
const packed = spawnSync(process.execPath, [fileURLToPath(new URL("./pack-cli.mjs", import.meta.url))], { stdio: "inherit" });
if (packed.status !== 0) process.exit(1);
const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "build"], {
  stdio: "inherit",
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
});
child.on("error", (error) => { console.error(error); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
