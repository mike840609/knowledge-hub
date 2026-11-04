import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseTaskArtifact, parseTaskContent } from "@/modules/task-knowledge/domain/task-artifact";

const CLI = path.join(process.cwd(), "tools/knowledge-hub/bin/knowledge-hub.mjs");
const FIXTURES = path.join(process.cwd(), "tests/fixtures/task-artifact");
const B1 = "0192f0a4-1b2c-7d3e-8f40-0000000000b1";
const B2 = "0192f0a4-1b2c-7d3e-8f40-0000000000b2";
const TOKEN = "khx_TEST-token-value-that-must-never-leak-0001";
const TOKEN2 = "khx_TEST-token-value-that-must-never-leak-0002";

const fixture = (file: string) => readFileSync(path.join(FIXTURES, file), "utf8");
const minimal = JSON.parse(fixture("content/valid-minimal.json"));
const content = (overrides: Record<string, unknown> = {}) => JSON.stringify({ ...minimal, ...overrides });

type Reply = { status: number; body?: unknown; raw?: string; location?: string } | "timeout";
type Received = { token: string | undefined; body: Buffer; json: Record<string, unknown> };

/** A stand-in Knowledge Hub: answers from a queue, else accepts as the configured binding would. */
class FakeHub {
  private server!: Server;
  private sockets = new Set<Socket>();
  replies: Reply[] = [];
  received: Received[] = [];
  bindingId = B1;
  url = "";

  async start() {
    this.server = createServer((request, response) => void this.handle(request, response));
    this.server.on("connection", (socket) => { this.sockets.add(socket); socket.on("close", () => this.sockets.delete(socket)); });
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    const address = this.server.address();
    this.url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  }

  async stop() {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    const json = JSON.parse(body.toString("utf8"));
    this.received.push({ token: request.headers["x-knowledge-hub-export-token"] as string | undefined, body, json });
    const reply = this.replies.shift() ?? { status: 201, body: { taskResultId: `tr-${json.taskId}`, revisionNo: json.artifactRevision, bindingId: this.bindingId, url: "/w/w1/tasks/tr" } };
    if (reply === "timeout") return;
    response.writeHead(reply.status, { "content-type": reply.raw === undefined ? "application/json" : "text/html", ...(reply.location ? { location: reply.location } : {}) });
    response.end(reply.raw ?? JSON.stringify(reply.body ?? {}));
  }
}

const ok = (status: number, bindingId = B1, revisionNo = 1) => ({ status, body: { taskResultId: "tr", revisionNo, bindingId, url: "/w/w1/tasks/tr" } });
const error = (status: number, code: string, extra: Record<string, unknown> = {}) => ({ status, body: { error: { code, message: `${code} message`, ...extra } } });

let hub: FakeHub;
let home: string;
let project: string;
let outputs: string[];

function run(args: string[], options: { stdin?: string; cwd?: string } = {}): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [CLI, ...args], {
      cwd: options.cwd ?? project,
      env: { NODE_ENV: "test", HOME: home, USERPROFILE: home, PATH: process.env.PATH ?? "", KNOWLEDGE_HUB_TIMEOUT_MS: "1500" },
    });
    let out = "";
    child.stdout.on("data", (data) => { out += data; });
    child.stderr.on("data", (data) => { out += data; });
    child.stdin.end(options.stdin ?? "");
    child.on("close", (code) => {
      outputs.push(out, args.join(" "));
      resolve({ code: code ?? -1, out });
    });
  });
}

const configure = (extra: string[] = [], stdin = TOKEN, cwd?: string) =>
  run(["configure", "--hub-url", hub.url, "--binding-id", B1, "--allow-insecure-localhost", ...extra], { stdin, cwd });
const exportNew = (stdin = content()) => run(["export", "--new"], { stdin });
const taskIdOf = (out: string) => /Task ID: ([0-9a-f-]{36})/.exec(out)?.[1] ?? /--retry ([0-9a-f-]{36})/.exec(out)?.[1] ?? "";

function filesUnder(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const full = path.join(root, name);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}
const savedRevisions = () => filesUnder(home).filter((file) => /rev-\d+\.json$/.test(file));

beforeEach(async () => {
  hub = new FakeHub();
  await hub.start();
  home = realpathSync(mkdtempSync(path.join(tmpdir(), "kh-home-")));
  project = realpathSync(mkdtempSync(path.join(tmpdir(), "kh-project-")));
  outputs = [];
});

afterEach(async () => {
  await hub.stop();
  // The token never leaves the credential file: not in output, arguments, saved revisions or the project.
  for (const output of outputs) expect(output).not.toContain(TOKEN);
  for (const file of [...filesUnder(home).filter((f) => !f.includes(`${path.sep}credentials${path.sep}`)), ...filesUnder(project)]) {
    expect(readFileSync(file, "utf8")).not.toContain(TOKEN);
  }
  rmSync(home, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

describe("configure", () => {
  it("stores the credential once per binding, outside the project, private to the user", async () => {
    expect((await configure()).code).toBe(0);
    const credentials = filesUnder(home).filter((file) => file.includes(`${path.sep}credentials${path.sep}`));
    expect(credentials).toHaveLength(1);
    expect(readFileSync(credentials[0], "utf8")).toContain(TOKEN);
    if (process.platform !== "win32") expect(statSync(credentials[0]).mode & 0o777).toBe(0o600);
    expect(filesUnder(project)).toEqual([]);
  });

  it("refuses a token in argv", async () => {
    const result = await run(["configure", "--hub-url", hub.url, "--binding-id", B1, "--allow-insecure-localhost", "--token", "khx_x"]);
    expect(result.code).toBe(2);
  });

  it("refuses http:// without the flag, and any non-localhost http:// with it", async () => {
    expect((await run(["configure", "--hub-url", hub.url, "--binding-id", B1], { stdin: TOKEN })).code).toBe(2);
    expect((await run(["configure", "--hub-url", "http://hub.example.com", "--binding-id", B1, "--allow-insecure-localhost"], { stdin: TOKEN })).code).toBe(2);
    expect((await run(["configure", "--hub-url", "http://localhost:3000", "--binding-id", B1, "--allow-insecure-localhost"], { stdin: TOKEN })).code).toBe(0);
    expect((await run(["configure", "--hub-url", "https://hub.example.com", "--binding-id", B1], { stdin: TOKEN })).code).toBe(0);
  });

  it("gives two worktrees of one repository two keys, and joins them only through --from", async () => {
    const git = (args: string[], cwd = project) => spawnSync("git", args, { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } });
    git(["init", "-q"]);
    git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "x"]);
    const sibling = path.join(project, "..", `${path.basename(project)}-wt`);
    git(["worktree", "add", "-q", sibling]);
    try {
      await configure();
      const nested = path.join(project, "sub");
      mkdirSync(nested);
      expect((await run(["export", "--new"], { stdin: content(), cwd: nested })).code).toBe(0);
      const unconfigured = await run(["export", "--new"], { stdin: content(), cwd: sibling });
      expect(unconfigured.code).toBe(2);
      expect(hub.received).toHaveLength(1);
      const joined = await run(["configure", "--from", project], { cwd: sibling });
      expect(joined.code).toBe(0);
      expect(joined.out).toContain(B1);
      expect((await run(["export", "--new"], { stdin: content(), cwd: sibling })).code).toBe(0);
      expect(hub.received.map((request) => request.token)).toEqual([TOKEN, TOKEN]);
    } finally {
      rmSync(sibling, { recursive: true, force: true });
    }
  });

  it("separates bindings by --profile", async () => {
    await configure();
    await run(["configure", "--profile", "team", "--hub-url", hub.url, "--binding-id", B2, "--allow-insecure-localhost"], { stdin: TOKEN2 });
    hub.bindingId = B2;
    expect((await run(["export", "--new", "--profile", "team"], { stdin: content() })).code).toBe(0);
    expect(hub.received[0].token).toBe(TOKEN2);
  });

  it("--rotate updates every key that shares the binding", async () => {
    await configure();
    const other = realpathSync(mkdtempSync(path.join(tmpdir(), "kh-other-")));
    try {
      await run(["configure", "--from", project], { cwd: other });
      expect((await run(["configure", "--rotate", B1], { stdin: TOKEN2 })).code).toBe(0);
      await exportNew();
      await run(["export", "--new"], { stdin: content(), cwd: other });
      expect(hub.received.map((request) => request.token)).toEqual([TOKEN2, TOKEN2]);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});

describe("configure after a rotation", () => {
  it("replaces the stored credential when configure is run again with a new token", async () => {
    await configure();
    expect((await configure([], TOKEN2)).code).toBe(0);
    await exportNew();
    expect(hub.received[0].token).toBe(TOKEN2);
  });
});

describe("untrusted answers", () => {
  it("never follows a redirect, so the token reaches no other host", async () => {
    await configure();
    const elsewhere: string[] = [];
    const other = createServer((request, response) => { elsewhere.push(String(request.headers["x-knowledge-hub-export-token"])); response.end(); });
    await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", resolve));
    const port = (other.address() as { port: number }).port;
    try {
      for (const status of [302, 307]) hub.replies.push({ status, location: `http://127.0.0.1:${port}/steal` });
      const first = await run(["export", "--new"], { stdin: content() });
      expect(first.code).toBe(4);
      expect(first.out).toMatch(/redirect/i);
      const id = taskIdOf(first.out);
      expect((await run(["export", "--retry", id])).code).toBe(4);
      expect(elsewhere).toEqual([]);
      expect((await run(["export", "--retry", id])).code).toBe(0);
    } finally {
      await new Promise<void>((resolve) => other.close(() => resolve()));
    }
  });

  it("treats a 2xx that is not Knowledge Hub's answer as unknown, not as stored or mismatched", async () => {
    await configure();
    hub.replies.push({ status: 200, raw: "<html>sign in</html>" });
    const first = await run(["export", "--new"], { stdin: content() });
    expect(first.code).toBe(3);
    expect(first.out).toMatch(/may already be stored/i);
    expect(first.out).not.toMatch(/undefined/);
    expect((await run(["export", "--retry", taskIdOf(first.out)])).code).toBe(0);
  });
});

describe("export --new", () => {
  beforeEach(async () => { await configure(); });

  it("mints a UUIDv4 task, saves revision 1, and posts exactly the saved bytes", async () => {
    const result = await exportNew();
    expect(result.code).toBe(0);
    const [request] = hub.received;
    expect(request.token).toBe(TOKEN);
    expect(request.json).toMatchObject({ schemaVersion: 1, artifactRevision: 1, title: minimal.title });
    expect(request.json.taskId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const [saved] = savedRevisions();
    expect(readFileSync(saved).equals(request.body)).toBe(true);
    expect(result.out).toContain(`${hub.url}/w/w1/tasks/tr`);
    expect(result.out).toContain(`Task ID: ${request.json.taskId}`);
    expect(result.out).toContain(`knowledge-hub export --task ${request.json.taskId}`);
  });

  it.each(["taskId", "artifactRevision", "schemaVersion", "bindingId"])("refuses content carrying %s and sends nothing", async (field) => {
    expect((await exportNew(content({ [field]: 1 }))).code).toBe(2);
    expect(hub.received).toHaveLength(0);
  });

  it("refuses unsafe CODE_FILE paths but accepts a deleted file's relative path", async () => {
    for (const bad of ["../x.ts", "/abs/x.ts", "C:\\x.ts"]) {
      expect((await exportNew(content({ references: [{ type: "CODE_FILE", path: bad }] }))).code).toBe(2);
    }
    expect((await exportNew(content({ references: [{ type: "CODE_FILE", path: "src/removed-in-this-task.ts" }] }))).code).toBe(0);
  });

  it.each([
    ["the configured token", TOKEN, "configured-export-token"],
    ["a PEM private key", "-----BEGIN RSA PRIVATE KEY-----", "pem-private-key"],
    ["an AWS access key id", "AKIAABCDEFGHIJKLMNOP", "aws-access-key-id"],
    ["a GitHub token", `ghp_${"a".repeat(36)}`, "github-token"],
    ["a GitHub fine-grained token", `github_pat_${"A".repeat(30)}`, "github-token"],
  ])("refuses content containing %s, naming only the rule", async (_name, secret, rule) => {
    const result = await exportNew(content({ summary: `see ${secret} here` }));
    expect(result.code).toBe(2);
    expect(result.out).toContain(rule);
    expect(result.out).not.toContain(secret);
    expect(hub.received).toHaveLength(0);
  });

  it("refuses content that fits 64 KiB alone but not with the CLI fields", async () => {
    const target = 65536 - 20;
    const findings: string[] = [];
    while (Buffer.byteLength(content({ findings: [...findings, "x".repeat(3999)] })) < target) findings.push("x".repeat(3999));
    findings.push("x".repeat(target - Buffer.byteLength(content({ findings: [...findings, ""] }))));
    expect(Buffer.byteLength(content({ findings }))).toBe(target);
    const result = await exportNew(content({ findings }));
    expect(result.code).toBe(2);
    expect(hub.received).toHaveLength(0);
    expect(savedRevisions()).toHaveLength(0);
  });
});

describe("conformance with the server contract", () => {
  const cases = (dir: string) => readdirSync(path.join(FIXTURES, dir)).filter((f) => f.endsWith(".json")).map((f) => `${dir}/${f}`);
  const serverAccepts = (parse: (raw: unknown) => unknown, raw: unknown) => { try { parse(raw); return true; } catch { return false; } };

  it("accepts and rejects the shared fixtures exactly as the server parsers do", async () => {
    // @ts-expect-error -- the CLI is plain JavaScript with no type declarations
    const { validateArtifact, validateContent } = await import("../../tools/knowledge-hub/src/artifact.mjs");
    const cliAccepts = (validate: (raw: unknown) => unknown, raw: unknown) => { try { validate(raw); return true; } catch { return false; } };
    for (const file of ["content/valid-minimal.json", "content/valid-full.json", ...cases("content/invalid")]) {
      const raw = JSON.parse(fixture(file));
      expect([file, cliAccepts(validateContent, raw)]).toEqual([file, serverAccepts(parseTaskContent, raw)]);
    }
    for (const file of ["artifact/valid.json", ...cases("artifact/invalid")]) {
      const raw = JSON.parse(fixture(file));
      expect([file, cliAccepts(validateArtifact, raw)]).toEqual([file, serverAccepts(parseTaskArtifact, raw)]);
    }
  });
});

describe("unconfirmed revisions", () => {
  beforeEach(async () => { await configure(); });

  it("a committed-but-timed-out --new blocks a second --new until --retry confirms it", async () => {
    hub.replies.push("timeout");
    const first = await exportNew();
    expect(first.code).toBe(3);
    const taskId = taskIdOf(first.out);
    const blocked = await exportNew(content({ title: "Third" }));
    expect(blocked.code).toBe(2);
    expect(blocked.out).toContain(minimal.title);
    expect(blocked.out).toContain(minimal.completedAt);
    expect(blocked.out).toContain(minimal.summary.slice(0, 30));
    expect(blocked.out).toContain(`knowledge-hub export --retry ${taskId}`);
    hub.replies.push(ok(200));
    const retried = await run(["export", "--retry", taskId]);
    expect(retried.code).toBe(0);
    expect(hub.received[1].body.equals(hub.received[0].body)).toBe(true);
    expect((await exportNew(content({ title: "Third" }))).code).toBe(0);
  });

  it("lists every task with an unconfirmed revision", async () => {
    const a = taskIdOf((await exportNew()).out);
    const b = taskIdOf((await exportNew(content({ title: "B" }))).out);
    hub.replies.push("timeout", error(503, "WORKSPACE_BUSY"));
    expect((await run(["export", "--task", a], { stdin: content({ summary: "A two." }) })).code).toBe(3);
    expect((await run(["export", "--task", b], { stdin: content({ title: "B", summary: "B two." }) })).code).toBe(3);
    const listed = await exportNew(content({ title: "C" }));
    expect(listed.code).toBe(2);
    expect(listed.out).toContain(`--retry ${a}`);
    expect(listed.out).toContain(`--retry ${b}`);
  });

  it.each([
    [error(403, "SCOPE_DENIED")],
    [error(413, "PAYLOAD_TOO_LARGE")],
    [error(422, "INVALID_ARTIFACT")],
    [error(409, "REVISION_CONFLICT", { latestRevisionNo: 1 })],
    [error(409, "REVISION_OUT_OF_ORDER", { latestRevisionNo: 0 })],
  ])("a rejected revision (%j) never blocks the next --new", async (reply) => {
    hub.replies.push(reply);
    expect((await exportNew()).code).toBe(4);
    expect((await exportNew(content({ title: "Other" }))).code).toBe(0);
  });

  it.each([[error(401, "CREDENTIAL_INVALID")], [error(409, "TASK_ARCHIVED")]])("%j stays unconfirmed and --retry succeeds later", async (reply) => {
    hub.replies.push(reply);
    const first = await exportNew();
    expect(first.code).toBe(4);
    const taskId = taskIdOf(first.out);
    expect(first.out).toContain(`--discard ${taskId}`);
    expect((await exportNew(content({ title: "Other" }))).code).toBe(2);
    expect((await run(["export", "--retry", taskId])).code).toBe(0);
  });

  it("401 names configure --rotate and --discard; TASK_ARCHIVED names restore and --discard", async () => {
    hub.replies.push(error(401, "CREDENTIAL_INVALID"));
    const unauthorized = await exportNew();
    expect(unauthorized.out).toContain(`knowledge-hub configure --rotate ${B1}`);
    await run(["export", "--discard", taskIdOf(unauthorized.out)]);
    hub.replies.push(error(409, "TASK_ARCHIVED"));
    const archived = await exportNew();
    expect(archived.out).toMatch(/restore/i);
    expect(archived.out).toContain(`--discard ${taskIdOf(archived.out)}`);
  });

  it("continues from the server's latestRevisionNo after a revision 409", async () => {
    const taskId = taskIdOf((await exportNew()).out);
    hub.replies.push(error(409, "REVISION_OUT_OF_ORDER", { latestRevisionNo: 3 }));
    const refused = await run(["export", "--task", taskId], { stdin: content({ summary: "Second." }) });
    expect(refused.code).toBe(4);
    expect(refused.out).toContain(`knowledge-hub export --task ${taskId}`);
    expect((await run(["export", "--task", taskId], { stdin: content({ summary: "Third." }) })).code).toBe(0);
    expect(hub.received.at(-1)?.json.artifactRevision).toBe(4);
  });
});

describe("--discard", () => {
  beforeEach(async () => { await configure(); });

  it("rejects the unconfirmed revision so --new may run, and refuses when nothing is unconfirmed", async () => {
    hub.replies.push(error(401, "CREDENTIAL_INVALID"));
    const taskId = taskIdOf((await exportNew()).out);
    const discarded = await run(["export", "--discard", taskId]);
    expect(discarded.code).toBe(0);
    expect(discarded.out).not.toMatch(/may already be stored/i);
    expect((await run(["export", "--discard", taskId])).code).toBe(2);
    expect((await exportNew(content({ title: "Next" }))).code).toBe(0);
  });

  it.each([["a timeout", "timeout" as const], ["a 502", error(502, "BAD_GATEWAY")]])("warns after %s that the revision may already be stored", async (_name, reply) => {
    hub.replies.push(reply);
    const taskId = taskIdOf((await exportNew()).out);
    const discarded = await run(["export", "--discard", taskId]);
    expect(discarded.out).toMatch(/may already be stored/i);
    expect(discarded.out).toContain(`--retry ${taskId}`);
  });

  it("still warns after a timeout followed by a --retry answered 401", async () => {
    hub.replies.push("timeout", error(401, "CREDENTIAL_INVALID"));
    const taskId = taskIdOf((await exportNew()).out);
    expect((await run(["export", "--retry", taskId])).code).toBe(4);
    expect((await run(["export", "--discard", taskId])).out).toMatch(/may already be stored/i);
  });
});

describe("bindings", () => {
  beforeEach(async () => { await configure(); });

  it("a revoked binding: reconfigure, recorded-binding refusal, discard, then --new under the new binding", async () => {
    hub.replies.push(error(401, "CREDENTIAL_INVALID"));
    const taskId = taskIdOf((await exportNew()).out);
    await run(["configure", "--hub-url", hub.url, "--binding-id", B2, "--allow-insecure-localhost"], { stdin: TOKEN2 });
    hub.bindingId = B2;
    expect((await exportNew(content({ title: "New" }))).code).toBe(2);
    const retry = await run(["export", "--retry", taskId]);
    expect(retry.code).toBe(2);
    expect(retry.out).toContain(B1);
    expect(retry.out).toContain(B2);
    expect(retry.out).toContain(`--discard ${taskId}`);
    expect((await run(["export", "--discard", taskId])).code).toBe(0);
    expect((await exportNew(content({ title: "New" }))).code).toBe(0);
    expect(hub.received.at(-1)?.token).toBe(TOKEN2);
  });

  it("a response bindingId mismatch rejects the revision under the server's binding", async () => {
    hub.replies.push(ok(201, B2));
    const result = await exportNew();
    expect(result.code).toBe(4);
    expect(result.out).toContain(B1);
    expect(result.out).toContain(B2);
    expect(result.out).toContain(`knowledge-hub configure --rotate ${B1}`);
    const taskId = taskIdOf(result.out);
    expect((await run(["export", "--retry", taskId])).out).toMatch(/no unconfirmed revision/i);
    await run(["configure", "--rotate", B1], { stdin: TOKEN2 });
    const continued = await run(["export", "--task", taskId], { stdin: content({ summary: "Later." }) });
    expect(continued.code).toBe(2);
    expect(continued.out).toContain(B2);
    expect((await exportNew(content({ title: "Next" }))).code).toBe(0);
    expect(hub.received).toHaveLength(2);
  });
});

describe("revision numbers and state", () => {
  beforeEach(async () => { await configure(); });

  it("reuses a rejected revision number, replacing its file", async () => {
    const taskId = taskIdOf((await exportNew()).out);
    hub.replies.push(error(403, "SCOPE_DENIED"));
    expect((await run(["export", "--task", taskId], { stdin: content({ summary: "Two." }) })).code).toBe(4);
    expect((await run(["export", "--task", taskId], { stdin: content({ summary: "Two again." }) })).code).toBe(0);
    expect(hub.received.slice(1).map((r) => [r.json.artifactRevision, r.json.summary])).toEqual([[2, "Two."], [2, "Two again."]]);
    expect(savedRevisions().map((file) => path.basename(file)).sort()).toEqual(["rev-1.json", "rev-2.json"]);
  });

  it("sends revision 1 again when revision 1 was rejected and nothing newer is known", async () => {
    hub.replies.push(error(422, "INVALID_ARTIFACT"));
    const taskId = taskIdOf((await exportNew()).out);
    expect((await run(["export", "--task", taskId], { stdin: content({ summary: "Fixed." }) })).code).toBe(0);
    expect(hub.received.map((r) => r.json.artifactRevision)).toEqual([1, 1]);
  });

  it("--task waits for confirmation, then adds revision 2 and leaves revision 1 unchanged", async () => {
    hub.replies.push(error(503, "WORKSPACE_BUSY"));
    const first = await exportNew();
    expect(first.code).toBe(3);
    const taskId = taskIdOf(first.out);
    expect((await run(["export", "--task", taskId], { stdin: content({ summary: "Two." }) })).code).toBe(2);
    expect((await run(["export", "--retry", taskId])).code).toBe(0);
    const before = readFileSync(savedRevisions()[0]);
    expect((await run(["export", "--task", taskId], { stdin: content({ summary: "Two." }) })).code).toBe(0);
    expect(hub.received.at(-1)?.json.artifactRevision).toBe(2);
    expect(readFileSync(savedRevisions().find((f) => f.endsWith("rev-1.json"))!).equals(before)).toBe(true);
  });

  it("knows tasks only under their own key, and survives a lost state directory", async () => {
    const taskId = taskIdOf((await exportNew()).out);
    await run(["configure", "--profile", "other", "--hub-url", hub.url, "--binding-id", B1, "--allow-insecure-localhost"]);
    expect((await run(["export", "--task", taskId, "--profile", "other"], { stdin: content() })).code).toBe(2);
    rmSync(path.join(home, ".local", "state", "knowledge-hub"), { recursive: true, force: true });
    expect(savedRevisions()).toEqual([]);
    expect((await run(["export", "--task", taskId], { stdin: content() })).code).toBe(2);
    expect((await run(["export", "--retry", taskId])).code).toBe(2);
    expect((await exportNew()).code).toBe(0);
  });

  it("refuses to send a hand-edited saved revision", async () => {
    hub.replies.push(error(503, "WORKSPACE_BUSY"));
    const taskId = taskIdOf((await exportNew()).out);
    const [saved] = savedRevisions();
    writeFileSync(saved, readFileSync(saved, "utf8").replace(minimal.title, "Edited"));
    expect((await run(["export", "--retry", taskId])).code).toBe(2);
    expect(hub.received).toHaveLength(1);
  });

  it("--retry with nothing unconfirmed exits 0, and an unknown task exits 2", async () => {
    const taskId = taskIdOf((await exportNew()).out);
    expect((await run(["export", "--retry", taskId])).code).toBe(0);
    expect((await run(["export", "--retry", crypto.randomUUID()])).code).toBe(2);
    expect((await run(["export", "--task", crypto.randomUUID()], { stdin: content() })).code).toBe(2);
  });
});

describe("response codes", () => {
  beforeEach(async () => { await configure(); });

  it.each([400, 403, 405, 422])("%i exits 4", async (status) => {
    hub.replies.push(error(status, "X"));
    expect((await exportNew()).code).toBe(4);
  });

  it.each([500, 502, 503, 504])("%i exits 3 and names --retry", async (status) => {
    hub.replies.push(error(status, "X"));
    const result = await exportNew();
    expect(result.code).toBe(3);
    expect(result.out).toContain(`knowledge-hub export --retry ${taskIdOf(result.out)}`);
  });

  it("200 prints the URL, Task ID and --task command", async () => {
    hub.replies.push(ok(200));
    const result = await exportNew();
    expect(result.code).toBe(0);
    expect(result.out).toContain("Task ID:");
    expect(result.out).toContain("knowledge-hub export --task");
  });

  it("an unreachable Hub exits 3", async () => {
    expect((await run(["configure", "--hub-url", "http://127.0.0.1:9", "--binding-id", B1, "--allow-insecure-localhost"], { stdin: TOKEN })).code).toBe(0);
    expect((await exportNew()).code).toBe(3);
  });
});
