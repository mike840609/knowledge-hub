import { decodeExportProfile, EXIT, printable, profileOption, Refusal, timeoutMs } from "./export.mjs";
import { checkHubUrl, configKey, readConfig, readCredential } from "./project-config.mjs";

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value) => typeof value === "string";
/** C0 and C1 controls except tab, newline and carriage return; Markdown keeps those byte for byte. */
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

function context(flags) {
  const project = readConfig(configKey(flags.profile));
  if (!project) throw new Refusal(`Export is not configured${flags.profile ? ` for profile ${flags.profile}` : ""}. Run the \`knowledge-hub configure\` command from the Knowledge Hub setup page first.`);
  return project;
}

/** One credential-authenticated read; a redirect is never followed, so the token reaches no other host. */
async function get(project, path) {
  const token = readCredential(project.bindingId);
  if (!token) throw new Refusal(`No credential is stored for binding ${project.bindingId}. Run \`knowledge-hub configure --rotate ${project.bindingId}\`.`);
  const problem = checkHubUrl(project.hubUrl, project.allowInsecureLocalhost);
  if (problem) throw new Refusal(problem);
  try {
    const response = await fetch(`${project.hubUrl}${path}`, {
      method: "GET",
      headers: { "x-knowledge-hub-export-token": token },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs()),
    });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  } catch {
    return { status: 0, body: null };
  }
}

/** The fields search prints; anything else is not Knowledge Hub's answer. */
function searchAnswer(body) {
  return isObject(body)
    && Array.isArray(body.hits)
    && body.hits.every((hit) => isObject(hit)
      && isString(hit.id) && isString(hit.title) && isString(hit.snippet)
      && (hit.path === null || isString(hit.path)))
    && typeof body.hasMore === "boolean";
}

const documentAnswer = (body) => isObject(body) && isString(body.markdown);

/** The fields the route promises on a Task Result; the whole answer is printed as JSON. */
function taskAnswer(body) {
  return isObject(body)
    && isString(body.taskResultId)
    && typeof body.revisionNo === "number"
    && isObject(body.content)
    && Array.isArray(body.references);
}

function untrusted() {
  console.error("The answer (200) did not come from Knowledge Hub's read API.");
  return EXIT.RETRYABLE;
}

/** Status to exit code, with the exact next step where the owner must act. */
function failure(project, status, body, profile) {
  const code = isString(body?.error?.code) ? body.error.code : "";
  const message = isString(body?.error?.message) ? body.error.message : "";
  const detail = `${status}${code ? ` ${printable(code)}` : ""}${message ? `: ${printable(message)}` : ""}`;

  if (status === 401 || status === 403) {
    console.error(`Knowledge Hub refused the request (${detail}).`);
    console.error(`Run: knowledge-hub configure --rotate ${project.bindingId}`);
    return EXIT.ACTION;
  }
  if (status === 404) {
    console.error("Not found.");
    return EXIT.ACTION;
  }
  if (status === 409) {
    const candidates = Array.isArray(body?.error?.candidateDocumentIds)
      ? body.error.candidateDocumentIds.filter((id) => isString(id))
      : [];
    console.error(`The reference matches several documents (${detail}).`);
    for (const id of candidates) console.error(`knowledge-hub read ${printable(id)}${profileOption(profile)}`);
    return EXIT.ACTION;
  }
  if (status === 413) {
    console.error(`The content is too large to read (${detail}).`);
    return EXIT.ACTION;
  }
  if (status === 422) {
    console.error(`Knowledge Hub refused the request (${detail}).`);
    return EXIT.REFUSED;
  }
  if (status === 0) {
    console.error("No answer from Knowledge Hub (network error or timeout).");
    return EXIT.RETRYABLE;
  }
  if (status >= 300 && status < 400) {
    console.error(`Knowledge Hub answered with a redirect (${status}); it was not followed.`);
    return EXIT.RETRYABLE;
  }
  if (status >= 500 && code && message) {
    console.error(`Knowledge Hub answered ${status} (${printable(code)}: ${printable(message)}).`);
    return EXIT.RETRYABLE;
  }
  console.error(`Knowledge Hub answered ${status}.`);
  return EXIT.RETRYABLE;
}

export async function runSearch(flags, words) {
  try {
    flags = decodeExportProfile(flags);
    const project = context(flags);
    const query = new URLSearchParams({ q: words.join(" "), kind: flags.tasks ? "tasks" : "documents" });
    const { status, body } = await get(project, `/api/agent/search?${query}`);
    if (status !== 200) return failure(project, status, body, flags.profile);
    if (!searchAnswer(body)) return untrusted();
    if (body.hits.length === 0) console.log("No results.");
    for (const hit of body.hits) {
      console.log(`${printable(hit.id)}\t${hit.path === null ? "-" : printable(hit.path)}\t${printable(hit.title)}`);
      console.log(`    ${printable(hit.snippet)}`);
    }
    if (body.hasMore) console.log("More results exist. Narrow the search.");
    return EXIT.OK;
  } catch (error) {
    if (error instanceof Refusal) {
      console.error(error.message);
      return EXIT.REFUSED;
    }
    throw error;
  }
}

export async function runRead(flags, ref) {
  try {
    flags = decodeExportProfile(flags);
    const project = context(flags);
    const query = new URLSearchParams(flags.task ? { id: ref } : { ref });
    const path = flags.task ? `/api/agent/tasks?${query}` : `/api/agent/documents?${query}`;
    const { status, body } = await get(project, path);
    if (status === 200) {
      if (flags.task) {
        if (!taskAnswer(body)) return untrusted();
        console.log(JSON.stringify(body, null, 2));
      } else {
        if (!documentAnswer(body)) return untrusted();
        process.stdout.write(body.markdown.replace(CONTROL_CHARACTERS, ""));
      }
      return EXIT.OK;
    }
    if (status === 404) {
      console.error(flags.task ? "Not found. If this is a document ID, drop --task." : "Not found. If this is a Task Result ID, add --task.");
      return EXIT.ACTION;
    }
    return failure(project, status, body, flags.profile);
  } catch (error) {
    if (error instanceof Refusal) {
      console.error(error.message);
      return EXIT.REFUSED;
    }
    throw error;
  }
}
