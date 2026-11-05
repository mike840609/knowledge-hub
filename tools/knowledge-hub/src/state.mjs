import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { userDirs, writePrivate } from "./project-config.mjs";

// <state>/<key>/<taskId>/rev-<n>.json holds exactly the bytes measured, hashed
// and posted; meta.json beside it records each revision's hash, binding, state,
// last outcome and the sticky mayBeStored flag.

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const keyDir = (key) => path.join(userDirs().state, sha256(key).slice(0, 32));
const taskDir = (key, taskId) => path.join(keyDir(key), taskId);
const revisionFile = (key, taskId, n) => path.join(taskDir(key, taskId), `rev-${n}.json`);

/** Saved state the user must repair: never content the Agent should rewrite. */
export class StateError extends Error {}

export function readMeta(key, taskId) {
  const file = path.join(taskDir(key, taskId), "meta.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new StateError(`Saved export state is unreadable: ${path.dirname(file)}. Move that folder aside, then run the command again.`);
  }
}

export function writeMeta(key, meta) {
  writePrivate(path.join(taskDir(key, meta.taskId), "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
}

export function listMetas(key) {
  const dir = keyDir(key);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((taskId) => readMeta(key, taskId)).filter(Boolean);
}

export function saveRevision(key, taskId, n, bytes) {
  writePrivate(revisionFile(key, taskId, n), bytes);
  return sha256(bytes);
}

export function readRevision(key, taskId, n) {
  const file = revisionFile(key, taskId, n);
  return existsSync(file) ? readFileSync(file) : null;
}

/** The task's unconfirmed revision number, if any (there is at most one). */
export function unconfirmedRevision(meta) {
  const entry = Object.entries(meta.revisions).find(([, revision]) => revision.state === "unconfirmed");
  return entry ? Number(entry[0]) : null;
}

/** The latest revision the server is known to hold: confirmed, or reported in a 409. */
export function knownLatest(meta) {
  const confirmed = Object.entries(meta.revisions).filter(([, r]) => r.state === "confirmed").map(([n]) => Number(n));
  return Math.max(0, meta.knownLatestRevisionNo ?? 0, ...confirmed);
}
