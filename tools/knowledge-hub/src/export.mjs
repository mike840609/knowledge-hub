import { randomUUID } from "node:crypto";
import { MAX_ARTIFACT_BYTES, validateArtifact, validateContent } from "./artifact.mjs";
import { UsageError } from "./configure.mjs";
import { checkHubUrl, projectKey, readCredential, readProject } from "./project-config.mjs";
import { secretRule } from "./secret-scan.mjs";
import { knownLatest, listMetas, readMeta, readRevision, saveRevision, sha256, unconfirmedRevision, writeMeta } from "./state.mjs";

// Exit codes: 0 success; 2 refused locally, nothing sent; 3 retryable as is;
// 4 will not succeed without a user action.
export const EXIT = { OK: 0, REFUSED: 2, RETRYABLE: 3, ACTION: 4 };

class Refusal extends Error {}

const retryCommand = (taskId) => `knowledge-hub export --retry ${taskId}`;
const taskCommand = (taskId) => `knowledge-hub export --task ${taskId}`;
const discardCommand = (taskId) => `knowledge-hub export --discard ${taskId}`;

function context(flags) {
  const key = projectKey(process.cwd(), flags.profile);
  const project = readProject(key);
  if (!project) throw new Refusal("This project is not configured. Run `knowledge-hub configure` here first (or `configure --from <otherRoot>`).");
  return { key, project };
}

async function readStdin() {
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

function pendingList(key) {
  return listMetas(key).flatMap((meta) => {
    const n = unconfirmedRevision(meta);
    if (n === null) return [];
    const bytes = readRevision(key, meta.taskId, n);
    const saved = bytes ? JSON.parse(bytes.toString("utf8")) : {};
    const opening = typeof saved.summary === "string" ? saved.summary.slice(0, 120) : "";
    return [`- ${saved.title ?? "(unreadable)"} (completed ${saved.completedAt ?? "?"}, revision ${n})\n  ${opening}\n  ${retryCommand(meta.taskId)}`];
  });
}

function recordedBindingRefusal(meta, project) {
  if (meta.bindingId === project.bindingId) return;
  throw new Refusal(
    `Task ${meta.taskId} was sent under binding ${meta.bindingId}, but this project is now configured with binding ${project.bindingId}.\n` +
      `Run ${discardCommand(meta.taskId)}, or reconfigure this project to binding ${meta.bindingId}.`,
  );
}

const timeoutMs = () => Number(process.env.KNOWLEDGE_HUB_TIMEOUT_MS ?? 30_000);

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
async function send(key, project, meta, revisionNo) {
  const revision = meta.revisions[revisionNo];
  const bytes = readRevision(key, meta.taskId, revisionNo);
  if (!bytes || sha256(bytes) !== revision.hash) throw new Refusal(`The saved revision ${revisionNo} of task ${meta.taskId} was changed after it was saved; it will not be sent.`);
  const { status, body } = await post(project, bytes);
  const id = meta.taskId;
  const save = (changes) => { Object.assign(revision, changes); writeMeta(key, meta); };

  if (status === 0 || status >= 500) {
    save({ lastOutcome: "retryable", mayBeStored: true });
    console.error(`${status === 0 ? "No answer from Knowledge Hub (network error or timeout)" : `Knowledge Hub answered ${status}`}. Task ID: ${id}`);
    console.error(`The revision may already be stored. Run: ${retryCommand(id)}`);
    return EXIT.RETRYABLE;
  }
  if (status >= 300 && status < 400) {
    save({ lastOutcome: status });
    console.error(`Knowledge Hub answered with a redirect (${status}); it was not followed and nothing was sent elsewhere. Task ID: ${id}`);
    console.error(`Check the Hub URL (${project.hubUrl}) with knowledge-hub configure, then run: ${retryCommand(id)}`);
    return EXIT.ACTION;
  }
  const hubAnswer = typeof body?.bindingId === "string" && typeof body?.url === "string" && body.url.startsWith("/");
  if ((status === 200 || status === 201) && !hubAnswer) {
    save({ lastOutcome: "retryable", mayBeStored: true });
    console.error(`The answer (${status}) did not come from Knowledge Hub's ingest API. Task ID: ${id}`);
    console.error(`The revision may already be stored. Run: ${retryCommand(id)}`);
    return EXIT.RETRYABLE;
  }
  if (status === 200 || status === 201) {
    if (body.bindingId !== project.bindingId) {
      revision.bindingId = body.bindingId;
      meta.bindingId = body.bindingId;
      save({ state: "rejected", lastOutcome: status });
      console.error(`Knowledge Hub stored this revision under binding ${body.bindingId}, but this project is configured with binding ${project.bindingId}. Task ID: ${id}`);
      console.error(`The token stored for this project belongs to the other binding. Fix it with: knowledge-hub configure --rotate ${project.bindingId}`);
      return EXIT.ACTION;
    }
    save({ state: "confirmed", lastOutcome: status });
    console.log(`Saved to Knowledge Hub: ${project.hubUrl}${body.url}`);
    console.log(`Task ID: ${id}`);
    console.log(`To update this export later: ${taskCommand(id)}`);
    return EXIT.OK;
  }
  const code = body?.error?.code ?? "UNKNOWN";
  const message = body?.error?.message ?? "";
  if (typeof body?.error?.latestRevisionNo === "number") meta.knownLatestRevisionNo = Math.max(meta.knownLatestRevisionNo ?? 0, body.error.latestRevisionNo);
  if (status === 401) {
    save({ lastOutcome: 401 });
    console.error(`Knowledge Hub refused the export credential (401). Task ID: ${id}`);
    console.error(`Run: knowledge-hub configure --rotate ${project.bindingId}, then ${retryCommand(id)}`);
    console.error(`If the binding was revoked, drop this export with: ${discardCommand(id)}`);
    return EXIT.ACTION;
  }
  if (status === 409 && code === "TASK_ARCHIVED") {
    save({ lastOutcome: 409 });
    console.error(`This task is archived in My Space (409 TASK_ARCHIVED). Task ID: ${id}`);
    console.error(`Restore it in My Space, then run: ${retryCommand(id)}`);
    console.error(`If you archived it on purpose, drop this export with: ${discardCommand(id)}`);
    return EXIT.ACTION;
  }
  save({ state: "rejected", lastOutcome: status });
  console.error(`Knowledge Hub rejected revision ${revisionNo} (${status} ${code}${message ? `: ${message}` : ""}). Task ID: ${id}`);
  if (status === 409) console.error(`To send this content as the next revision, pipe it again to: ${taskCommand(id)}`);
  else console.error("The revision was rejected and blocks nothing.");
  return EXIT.ACTION;
}

async function exportNew(flags) {
  const { key, project } = context(flags);
  const pending = pendingList(key);
  if (pending.length > 0) {
    throw new Refusal(
      `Earlier exports from this project are not confirmed yet. If one of them is this same task, retry it instead of exporting again:\n${pending.join("\n")}`,
    );
  }
  const content = await readContent(project);
  const meta = { taskId: randomUUID(), bindingId: project.bindingId, knownLatestRevisionNo: 0, revisions: {} };
  saveNew(key, meta, 1, artifactBytes(meta.taskId, 1, content), project.bindingId);
  return send(key, project, meta, 1);
}

function knownTask(key, taskId) {
  const meta = taskId ? readMeta(key, taskId) : null;
  if (!meta) throw new Refusal(`Task ${taskId ?? "(none)"} is not known in this project's saved exports.`);
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
  recordedBindingRefusal(meta, project);
  return send(key, project, meta, n);
}

async function exportTask(flags) {
  const { key, project } = context(flags);
  const meta = knownTask(key, flags.task);
  const pending = unconfirmedRevision(meta);
  if (pending !== null) throw new Refusal(`Revision ${pending} of task ${meta.taskId} is not confirmed yet. Run ${retryCommand(meta.taskId)} first.`);
  recordedBindingRefusal(meta, project);
  const content = await readContent(project);
  const next = knownLatest(meta) + 1;
  saveNew(key, meta, next, artifactBytes(meta.taskId, next, content), project.bindingId);
  return send(key, project, meta, next);
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
    console.log(`Warning: an earlier send got no trustworthy answer, so this revision may already be stored in Knowledge Hub. Prefer ${retryCommand(meta.taskId)} first to find out.`);
  }
  return EXIT.OK;
}

export async function runExport(flags) {
  try {
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
    throw error;
  }
}
