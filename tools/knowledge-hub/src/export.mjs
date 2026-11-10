import { randomUUID } from "node:crypto";
import { MAX_ARTIFACT_BYTES, validateArtifact, validateContent } from "./artifact.mjs";
import { UsageError } from "./configure.mjs";
import { checkHubUrl, configKey, readConfig, readCredential } from "./project-config.mjs";
import { secretRule } from "./secret-scan.mjs";
import { knownLatest, listMetas, readMeta, readRevision, saveRevision, sha256, StateError, unconfirmedRevision, writeMeta } from "./state.mjs";

// Exit codes: 0 success; 2 refused locally, nothing sent; 3 retryable as is;
// 4 will not succeed without a user action.
export const EXIT = { OK: 0, REFUSED: 2, RETRYABLE: 3, ACTION: 4 };

export class Refusal extends Error {}

const TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Server text reaches the terminal without control characters: a hostile answer cannot drive it. */
export const printable = (value) => String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, "?");

// The 4xx codes the ingest route answers with; any other 4xx came from something else at that address.
const HUB_ERROR_CODES = new Set([
  "MALFORMED_JSON", "CREDENTIAL_INVALID", "SCOPE_DENIED", "REVISION_CONFLICT", "REVISION_OUT_OF_ORDER",
  "TASK_ARCHIVED", "PAYLOAD_TOO_LARGE", "INVALID_ARTIFACT", "UNSUPPORTED_SCHEMA_VERSION",
]);

// Printed commands must work in POSIX shells, PowerShell and Windows CMD.
// Plain profile slugs need no quoting. Encode anything else into shell-safe
// base64url to avoid invoking shell-specific expansions or escape rules.
const SIMPLE_PROFILE = /^[A-Za-z0-9_.-]+$/;
const profileOption = (profile) => !profile ? "" : SIMPLE_PROFILE.test(profile)
  ? ` --profile ${profile}`
  : ` --profile-b64 ${Buffer.from(profile, "utf8").toString("base64url")}`;

function decodeExportProfile(flags) {
  const encoded = flags["profile-b64"];
  if (encoded === undefined) return flags;
  if (flags.profile !== undefined) throw new UsageError("Use --profile or --profile-b64, not both.");
  if (typeof encoded !== "string" || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new UsageError("Invalid --profile-b64 value.");
  const profile = Buffer.from(encoded, "base64url").toString("utf8");
  if (!profile || Buffer.from(profile, "utf8").toString("base64url") !== encoded) throw new UsageError("Invalid --profile-b64 value.");
  return { ...flags, profile };
}
const retryCommand = (taskId, profile) => `knowledge-hub export --retry ${taskId}${profileOption(profile)}`;
const taskCommand = (taskId, profile) => `knowledge-hub export --task ${taskId}${profileOption(profile)}`;
const discardCommand = (taskId, profile) => `knowledge-hub export --discard ${taskId}${profileOption(profile)}`;

function context(flags) {
  const key = configKey(flags.profile);
  const project = readConfig(key);
  if (!project) throw new Refusal(`Export is not configured${flags.profile ? ` for profile ${flags.profile}` : ""}. Run the \`knowledge-hub configure\` command from the Knowledge Hub setup page first.`);
  return { key, project };
}

async function readStdin() {
  // Node's stream decoder buffers split UTF-8 sequences across pipe chunks.
  process.stdin.setEncoding("utf8");
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

/** Content from stdin: parsed, held to the contract, scanned for secrets. */
async function readContent(project) {
  const text = await readStdin();
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Refusal("stdin is not valid JSON task content.");
  }
  // The Agent cannot read the clock; the CLI can. Set once here, so a retry resends the same bytes.
  if (raw && typeof raw === "object" && !Array.isArray(raw) && raw.completedAt === undefined) raw.completedAt = new Date().toISOString();
  try {
    validateContent(raw);
  } catch (error) {
    throw new Refusal(`The task content was refused: ${error.message}`);
  }
  const rule = secretRule(text, readCredential(project.bindingId));
  if (rule) throw new Refusal(`The task content was refused because it looks like it contains a secret (rule: ${rule}). Remove it and run again.`);
  return raw;
}

/** The exact bytes that will be measured, hashed, saved and posted. */
function artifactBytes(taskId, revisionNo, content) {
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, taskId, artifactRevision: revisionNo, ...content }), "utf8");
  if (bytes.byteLength > MAX_ARTIFACT_BYTES) throw new Refusal(`The task is ${bytes.byteLength} bytes with its identity fields; the limit is ${MAX_ARTIFACT_BYTES}. Shorten it and run again.`);
  validateArtifact(JSON.parse(bytes.toString("utf8")));
  return bytes;
}

function saveNew(key, meta, revisionNo, bytes, bindingId) {
  const hash = saveRevision(key, meta.taskId, revisionNo, bytes);
  meta.revisions[revisionNo] = { hash, bindingId, state: "unconfirmed", lastOutcome: "none", mayBeStored: false };
  meta.bindingId = bindingId;
  writeMeta(key, meta);
}

function pendingList(key, profile) {
  return listMetas(key).flatMap((meta) => {
    const n = unconfirmedRevision(meta);
    if (n === null) return [];
    const bytes = readRevision(key, meta.taskId, n);
    const saved = bytes ? JSON.parse(bytes.toString("utf8")) : {};
    const opening = typeof saved.summary === "string" ? saved.summary.slice(0, 120) : "";
    return [`- ${printable(saved.title ?? "(unreadable)")} (completed ${printable(saved.completedAt ?? "?")}, revision ${n})\n  ${printable(opening)}\n  ${retryCommand(meta.taskId, profile)}`];
  });
}

function recordedBindingRefusal(meta, project, profile) {
  if (meta.bindingId === project.bindingId) return;
  throw new Refusal(
    `Task ${meta.taskId} was sent under binding ${meta.bindingId}, but export is now configured with binding ${project.bindingId}.\n` +
      `Run ${discardCommand(meta.taskId, profile)}, or run configure again with binding ${meta.bindingId}.`,
  );
}

export const timeoutMs = () => Number(process.env.KNOWLEDGE_HUB_TIMEOUT_MS ?? 30_000);

async function post(project, bytes) {
  const token = readCredential(project.bindingId);
  if (!token) throw new Refusal(`No credential is stored for binding ${project.bindingId}. Run \`knowledge-hub configure --rotate ${project.bindingId}\`.`);
  const problem = checkHubUrl(project.hubUrl, project.allowInsecureLocalhost);
  if (problem) throw new Refusal(problem);
  try {
    const response = await fetch(`${project.hubUrl}/api/task-results/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-knowledge-hub-export-token": token },
      body: bytes,
      // Never follow: a redirect would carry the token header to whatever host it names.
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs()),
    });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  } catch {
    return { status: 0, body: null };
  }
}

/** Sends one saved revision and turns the answer into its next state and the exact next step. */
async function send(key, project, meta, revisionNo, profile) {
  const revision = meta.revisions[revisionNo];
  const bytes = readRevision(key, meta.taskId, revisionNo);
  if (!bytes || sha256(bytes) !== revision.hash) throw new Refusal(`The saved revision ${revisionNo} of task ${meta.taskId} was changed after it was saved; it will not be sent.`);
  const { status, body } = await post(project, bytes);
  const id = meta.taskId;
  const save = (changes) => { Object.assign(revision, changes); writeMeta(key, meta); };

  if (status === 0 || status >= 500) {
    save({ lastOutcome: "retryable", mayBeStored: true });
    console.error(`${status === 0 ? "No answer from Knowledge Hub (network error or timeout)" : `Knowledge Hub answered ${status}`}. Task ID: ${id}`);
    console.error(`The revision may already be stored. Run: ${retryCommand(id, profile)}`);
    return EXIT.RETRYABLE;
  }
  if (status >= 300 && status < 400) {
    save({ lastOutcome: status });
    console.error(`Knowledge Hub answered with a redirect (${status}); it was not followed and nothing was sent elsewhere. Task ID: ${id}`);
    console.error(`Check the Hub URL (${project.hubUrl}) with knowledge-hub configure, then run: ${retryCommand(id, profile)}`);
    return EXIT.ACTION;
  }
  const hubAnswer = typeof body?.bindingId === "string" && typeof body?.url === "string" && body.url.startsWith("/");
  if ((status === 200 || status === 201) && !hubAnswer) {
    save({ lastOutcome: "retryable", mayBeStored: true });
    console.error(`The answer (${status}) did not come from Knowledge Hub's ingest API. Task ID: ${id}`);
    console.error(`The revision may already be stored. Run: ${retryCommand(id, profile)}`);
    return EXIT.RETRYABLE;
  }
  if (status === 200 || status === 201) {
    if (body.bindingId !== project.bindingId) {
      revision.bindingId = body.bindingId;
      meta.bindingId = body.bindingId;
      save({ state: "rejected", lastOutcome: status });
      console.error(`Knowledge Hub stored this revision under binding ${printable(body.bindingId)}, but export is configured with binding ${project.bindingId}. Task ID: ${id}`);
      console.error(`The stored token belongs to the other binding. Fix it with: knowledge-hub configure --rotate ${project.bindingId}`);
      return EXIT.ACTION;
    }
    save({ state: "confirmed", lastOutcome: status });
    console.log(`Saved to Knowledge Hub: ${project.hubUrl}${printable(body.url)}`);
    console.log(`Task ID: ${id}`);
    console.log(`To update this export later: ${taskCommand(id, profile)}`);
    return EXIT.OK;
  }
  if (status < 500 && !HUB_ERROR_CODES.has(body?.error?.code)) {
    save({ lastOutcome: status });
    console.error(`The answer (${status}) is not Knowledge Hub's answer; the revision was kept unsent. Task ID: ${id}`);
    console.error(`Check the Hub URL (${project.hubUrl}) with knowledge-hub configure, then run: ${retryCommand(id, profile)}`);
    return EXIT.ACTION;
  }
  const code = body?.error?.code ?? "UNKNOWN";
  const message = body?.error?.message ?? "";
  if (typeof body?.error?.latestRevisionNo === "number") meta.knownLatestRevisionNo = Math.max(meta.knownLatestRevisionNo ?? 0, body.error.latestRevisionNo);
  if (status === 401) {
    save({ lastOutcome: 401 });
    console.error(`Knowledge Hub refused the export credential (401). Task ID: ${id}`);
    console.error(`Run: knowledge-hub configure --rotate ${project.bindingId}, then ${retryCommand(id, profile)}`);
    console.error(`If the binding was revoked, drop this export with: ${discardCommand(id, profile)}`);
    return EXIT.ACTION;
  }
  if (status === 409 && code === "TASK_ARCHIVED") {
    save({ lastOutcome: 409 });
    console.error(`This task is archived in My Space (409 TASK_ARCHIVED). Task ID: ${id}`);
    console.error(`Restore it in My Space, then run: ${retryCommand(id, profile)}`);
    console.error(`If you archived it on purpose, drop this export with: ${discardCommand(id, profile)}`);
    return EXIT.ACTION;
  }
  save({ state: "rejected", lastOutcome: status });
  console.error(`Knowledge Hub rejected revision ${revisionNo} (${status} ${printable(code)}${message ? `: ${printable(message)}` : ""}). Task ID: ${id}`);
  if (status === 409) console.error(`To send this content as the next revision, pipe it again to: ${taskCommand(id, profile)}`);
  else console.error("The revision was rejected and blocks nothing.");
  return EXIT.ACTION;
}

async function exportNew(flags) {
  const { key, project } = context(flags);
  const pending = pendingList(key, flags.profile);
  if (pending.length > 0) {
    throw new Refusal(
      `Earlier exports are not confirmed yet. If one of them is this same task, retry it instead of exporting again:\n${pending.join("\n")}`,
    );
  }
  const content = await readContent(project);
  const meta = { taskId: randomUUID(), bindingId: project.bindingId, knownLatestRevisionNo: 0, revisions: {} };
  saveNew(key, meta, 1, artifactBytes(meta.taskId, 1, content), project.bindingId);
  return send(key, project, meta, 1, flags.profile);
}

function knownTask(key, taskId) {
  if (taskId !== undefined && !TASK_ID.test(taskId)) throw new UsageError(`${printable(taskId)} is not a Task ID.`);
  const meta = taskId ? readMeta(key, taskId) : null;
  if (!meta) throw new Refusal(`Task ${taskId ?? "(none)"} is not known in the saved exports on this machine.`);
  return meta;
}

async function exportRetry(flags) {
  const { key, project } = context(flags);
  const meta = knownTask(key, flags.retry);
  const n = unconfirmedRevision(meta);
  if (n === null) {
    console.log(`Task ${meta.taskId} has no unconfirmed revision; nothing to retry.`);
    return EXIT.OK;
  }
  recordedBindingRefusal(meta, project, flags.profile);
  return send(key, project, meta, n, flags.profile);
}

async function exportTask(flags) {
  const { key, project } = context(flags);
  const meta = knownTask(key, flags.task);
  const pending = unconfirmedRevision(meta);
  if (pending !== null) throw new Refusal(`Revision ${pending} of task ${meta.taskId} is not confirmed yet. Run ${retryCommand(meta.taskId, flags.profile)} first.`);
  recordedBindingRefusal(meta, project, flags.profile);
  const content = await readContent(project);
  const next = knownLatest(meta) + 1;
  saveNew(key, meta, next, artifactBytes(meta.taskId, next, content), project.bindingId);
  return send(key, project, meta, next, flags.profile);
}

async function exportDiscard(flags) {
  const { key } = context(flags);
  const meta = knownTask(key, flags.discard);
  const n = unconfirmedRevision(meta);
  if (n === null) throw new Refusal(`Task ${meta.taskId} has no unconfirmed revision to discard.`);
  const revision = meta.revisions[n];
  revision.state = "rejected";
  writeMeta(key, meta);
  console.log(`Discarded revision ${n} of task ${meta.taskId}. Nothing was removed from Knowledge Hub.`);
  if (revision.mayBeStored) {
    console.log(`Warning: an earlier send got no trustworthy answer, so this revision may already be stored in Knowledge Hub. Prefer ${retryCommand(meta.taskId, flags.profile)} first to find out.`);
  }
  return EXIT.OK;
}

export async function runExport(flags) {
  try {
    flags = decodeExportProfile(flags);
    if (flags.new) return await exportNew(flags);
    if (flags.retry) return await exportRetry(flags);
    if (flags.task) return await exportTask(flags);
    if (flags.discard) return await exportDiscard(flags);
    throw new UsageError("Use one of: export --new | --retry <taskId> | --task <taskId> | --discard <taskId>");
  } catch (error) {
    if (error instanceof Refusal || error instanceof UsageError) {
      console.error(error.message);
      return EXIT.REFUSED;
    }
    if (error instanceof StateError) {
      console.error(error.message);
      return EXIT.ACTION;
    }
    throw error;
  }
}
