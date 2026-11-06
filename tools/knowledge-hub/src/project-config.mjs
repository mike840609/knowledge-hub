import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const IS_WINDOWS = process.platform === "win32";

/** Per-user directories, outside every project: credentials and config, and the revision state. */
export function userDirs() {
  const home = homedir();
  if (IS_WINDOWS) {
    const roaming = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    const local = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
    return { config: path.join(roaming, "knowledge-hub"), state: path.join(local, "knowledge-hub", "state") };
  }
  const config = process.env.XDG_CONFIG_HOME ?? path.join(home, ".config");
  const state = process.env.XDG_STATE_HOME ?? path.join(home, ".local", "state");
  return { config: path.join(config, "knowledge-hub"), state: path.join(state, "knowledge-hub") };
}

/** Config is per user, not per project: one key per profile (task knowledge export design, Amendment 2). */
export function configKey(profile) {
  return profile ? `profile=${profile}` : "default";
}

function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Atomic and private: write a sibling, then rename it over the target. */
export function writePrivate(file, text) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, text, { mode: 0o600 });
  if (!IS_WINDOWS) chmodSync(temporary, 0o600);
  renameSync(temporary, file);
}

const profilesFile = () => path.join(userDirs().config, "profiles.json");
const credentialFile = (bindingId) => path.join(userDirs().config, "credentials", `${bindingId}.json`);

export function readConfig(key) {
  return readJson(profilesFile(), {})[key] ?? null;
}

export function writeConfig(key, config) {
  const all = readJson(profilesFile(), {});
  all[key] = config;
  writePrivate(profilesFile(), `${JSON.stringify(all, null, 2)}\n`);
}

export function keysUsingBinding(bindingId) {
  return Object.entries(readJson(profilesFile(), {})).filter(([, config]) => config.bindingId === bindingId).map(([key]) => key);
}

export function readCredential(bindingId) {
  return readJson(credentialFile(bindingId), null)?.token ?? null;
}

export function writeCredential(bindingId, token) {
  writePrivate(credentialFile(bindingId), `${JSON.stringify({ bindingId, token })}\n`);
}

/** HTTPS always; plain HTTP only to this machine, and only when the key opted in. */
export function checkHubUrl(raw, allowInsecureLocalhost) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return "The Hub URL is not a URL.";
  }
  if (url.username || url.password) return "The Hub URL must not contain a user name or password.";
  if (url.protocol === "https:") return null;
  if (url.protocol === "http:" && allowInsecureLocalhost && ["localhost", "127.0.0.1"].includes(url.hostname)) return null;
  return url.protocol === "http:"
    ? "Plain http:// is refused. Use https://, or --allow-insecure-localhost for a local development server (localhost or 127.0.0.1 only)."
    : "The Hub URL must use https://.";
}
