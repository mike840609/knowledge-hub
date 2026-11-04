import { createInterface } from "node:readline";
import { checkHubUrl, IS_WINDOWS, keysUsingBinding, projectKey, readCredential, readProject, writeCredential, writeProject } from "./project-config.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class UsageError extends Error {}

async function readAllStdin() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

/** A hidden prompt on a terminal; otherwise the whole of stdin. Never argv. */
async function readToken(prompt) {
  if (!process.stdin.isTTY) return (await readAllStdin()).trim();
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  const write = rl._writeToOutput?.bind(rl);
  rl._writeToOutput = (text) => { if (write && text.includes(prompt)) write(text); };
  const token = await new Promise((resolve) => rl.question(prompt, resolve));
  rl.close();
  process.stderr.write("\n");
  return token.trim();
}

async function ask(question) {
  if (!process.stdin.isTTY) throw new UsageError(`Missing ${question}; pass it as a flag.`);
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise((resolve) => rl.question(`${question}: `, resolve));
  rl.close();
  return answer.trim();
}

function storeCredential(bindingId, token) {
  if (!token) throw new UsageError("No token was entered.");
  writeCredential(bindingId, token);
  if (IS_WINDOWS) console.log("Warning: on Windows the credential file is protected only by your user profile's access control.");
}

export async function configure(flags) {
  if (flags.token !== undefined) throw new UsageError("A token is never accepted as an argument; it is read from a hidden prompt or stdin.");
  if (flags.rotate) {
    if (!UUID.test(flags.rotate)) throw new UsageError("--rotate needs a binding ID.");
    storeCredential(flags.rotate, await readToken(`New export token for binding ${flags.rotate}: `));
    console.log(`Credential for binding ${flags.rotate} replaced; ${keysUsingBinding(flags.rotate).length} project key(s) use it.`);
    return 0;
  }
  const key = projectKey(process.cwd(), flags.profile);
  if (flags.from) {
    const source = readProject(projectKey(flags.from, flags.profile));
    if (!source) throw new UsageError(`${flags.from} is not configured${flags.profile ? ` for profile ${flags.profile}` : ""}.`);
    writeProject(key, source);
    console.log(`This project now shares binding ${source.bindingId} with ${flags.from}. Both export into the same binding.`);
    return 0;
  }
  const hubUrl = (flags["hub-url"] ?? (await ask("Knowledge Hub URL"))).replace(/\/+$/, "");
  const allowInsecureLocalhost = flags["allow-insecure-localhost"] === true;
  const problem = checkHubUrl(hubUrl, allowInsecureLocalhost);
  if (problem) throw new UsageError(problem);
  const bindingId = flags["binding-id"] ?? (await ask("Binding ID"));
  if (!UUID.test(bindingId)) throw new UsageError("The binding ID is not a valid ID.");
  if (!readCredential(bindingId)) storeCredential(bindingId, await readToken(`Export token for binding ${bindingId}: `));
  writeProject(key, { hubUrl, bindingId, allowInsecureLocalhost });
  console.log(`Configured ${key} to export with binding ${bindingId}.`);
  return 0;
}
