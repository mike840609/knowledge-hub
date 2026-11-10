import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CLI = path.join(process.cwd(), "tools/knowledge-hub/bin/knowledge-hub.mjs");
const B1 = "0192f0a4-1b2c-7d3e-8f40-0000000000b1";
const TOKEN = "khx_TEST-token-value-that-must-never-leak-0001";

type Reply = { status: number; body?: unknown; raw?: string; location?: string } | "timeout";
type Received = { method: string | undefined; url: URL; token: string | undefined; body: Buffer };

/** A stand-in Knowledge Hub: answers reads from a queue and records every request. */
class FakeHub {
  private server!: Server;
  private sockets = new Set<Socket>();
  replies: Reply[] = [];
  received: Received[] = [];
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
    this.received.push({
      method: request.method,
      url: new URL(request.url ?? "/", "http://hub.invalid"),
      token: request.headers["x-knowledge-hub-export-token"] as string | undefined,
      body,
    });
    const reply = this.replies.shift() ?? { status: 500, raw: "unexpected request" };
    if (reply === "timeout") return;
    response.writeHead(reply.status, {
      "content-type": reply.raw === undefined ? "application/json" : "text/html",
      ...(reply.location ? { location: reply.location } : {}),
    });
    response.end(reply.raw ?? JSON.stringify(reply.body ?? {}));
  }
}

const hits = (items: Record<string, unknown>[], hasMore = false) => ({ status: 200, body: { kind: "documents", hits: items, hasMore } });
const error = (status: number, code: string, extra: Record<string, unknown> = {}) => ({ status, body: { error: { code, message: `${code} message`, ...extra } } });
const hit = (id: string, title: string, sourcePath: string | null, snippet: string) => ({ id, title, path: sourcePath, snippet });

let hub: FakeHub;
let home: string;
let project: string;
let outputs: string[];

function run(args: string[], options: { stdin?: string } = {}): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [CLI, ...args], {
      cwd: project,
      env: { NODE_ENV: "test", HOME: home, USERPROFILE: home, PATH: process.env.PATH ?? "", KNOWLEDGE_HUB_TIMEOUT_MS: "1500" },
    });
    let out = "";
    child.stdout.on("data", (data) => { out += data; });
    child.stderr.on("data", (data) => { out += data; });
    child.stdin.end(options.stdin ?? "");
    child.on("close", (code) => {
      outputs.push(out);
      resolve({ code: code ?? -1, out });
    });
  });
}

const configure = (extra: string[] = [], stdin = TOKEN) =>
  run(["configure", "--hub-url", hub.url, "--binding-id", B1, "--allow-insecure-localhost", ...extra], { stdin });

beforeEach(async () => {
  hub = new FakeHub();
  await hub.start();
  home = realpathSync(mkdtempSync(path.join(tmpdir(), "kh-home-")));
  project = realpathSync(mkdtempSync(path.join(tmpdir(), "kh-project-")));
  outputs = [];
});

afterEach(async () => {
  await hub.stop();
  // The token never leaves the credential file: not in output or arguments.
  for (const output of outputs) expect(output).not.toContain(TOKEN);
  rmSync(home, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

describe("search", () => {
  beforeEach(async () => { await configure(); });

  it("search prints one hit per two lines and exits 0", async () => {
    hub.replies.push(hits([
      hit("doc-1", "Auth flow", "architecture/auth.md", "How sign-in works."),
      hit("doc-2", "Tasks", null, "A task."),
    ]));
    const result = await run(["search", "auth", "flow"]);
    expect(result.code).toBe(0);
    expect(result.out).toBe(
      "doc-1\tarchitecture/auth.md\tAuth flow\n    How sign-in works.\n" +
        "doc-2\t-\tTasks\n    A task.\n",
    );
    expect(hub.received[0].method).toBe("GET");
    expect(hub.received[0].url.searchParams.get("kind")).toBe("documents");
  });

  it("search with no hits prints 'No results.' and exits 0", async () => {
    hub.replies.push(hits([]));
    const result = await run(["search", "nothing"]);
    expect(result.code).toBe(0);
    expect(result.out).toBe("No results.\n");
  });

  it("search sends q, kind=tasks with --tasks, the token header, and no body", async () => {
    hub.replies.push({ status: 200, body: { kind: "tasks", hits: [], hasMore: false } });
    const result = await run(["search", "--tasks", "auth", "flow"]);
    expect(result.code).toBe(0);
    const [request] = hub.received;
    expect(request.method).toBe("GET");
    expect(request.url.pathname).toBe("/api/agent/search");
    expect(request.url.searchParams.get("q")).toBe("auth flow");
    expect(request.url.searchParams.get("kind")).toBe("tasks");
    expect(request.token).toBe(TOKEN);
    expect(request.body).toHaveLength(0);
  });

  it("search replaces control characters in title, path and snippet with ?", async () => {
    hub.replies.push(hits([hit("doc-1", "a\u001b[2Jb", "p\u0007ath", "s\u009bnippet")]));
    const result = await run(["search", "auth"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("a?[2Jb");
    expect(result.out).toContain("p?ath");
    expect(result.out).toContain("s?nippet");
    expect(result.out).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
  });

  it("search prints the hasMore line last", async () => {
    hub.replies.push(hits([hit("doc-1", "Auth", null, "One.")], true));
    const result = await run(["search", "auth"]);
    expect(result.code).toBe(0);
    expect(result.out.endsWith("More results exist. Narrow the search.\n")).toBe(true);
  });
});

describe("read", () => {
  beforeEach(async () => { await configure(); });

  it("read prints the markdown byte for byte", async () => {
    const markdown = "# Auth\n\nSign in — 中文.\n";
    hub.replies.push({ status: 200, body: { documentId: "doc-1", markdown } });
    const result = await run(["read", "architecture/auth.md"]);
    expect(result.code).toBe(0);
    expect(result.out).toBe(markdown);
    expect(hub.received[0].method).toBe("GET");
    expect(hub.received[0].url.pathname).toBe("/api/agent/documents");
    expect(hub.received[0].url.searchParams.get("ref")).toBe("architecture/auth.md");
    expect(hub.received[0].token).toBe(TOKEN);
    expect(hub.received[0].body).toHaveLength(0);
  });

  it("read --task prints the Task Result as JSON", async () => {
    const task = { taskResultId: "tr-1", revisionNo: 3, content: { title: "T", summary: "S" }, references: [] };
    hub.replies.push({ status: 200, body: task });
    const result = await run(["read", "tr-1", "--task"]);
    expect(result.code).toBe(0);
    expect(result.out).toBe(`${JSON.stringify(task, null, 2)}\n`);
    expect(hub.received[0].url.pathname).toBe("/api/agent/tasks");
    expect(hub.received[0].url.searchParams.get("id")).toBe("tr-1");
  });

  it("read on 404 exits 4 and names --task; with --task names dropping it", async () => {
    hub.replies.push(error(404, "NOT_FOUND"));
    const document = await run(["read", "missing.md"]);
    expect(document.code).toBe(4);
    expect(document.out).toContain("Not found. If this is a Task Result ID, add --task.");

    hub.replies.push(error(404, "NOT_FOUND"));
    const task = await run(["read", "missing-id", "--task"]);
    expect(task.code).toBe(4);
    expect(task.out).toContain("Not found. If this is a document ID, drop --task.");
  });

  it("read on 409 exits 4 and prints a read command per candidate", async () => {
    hub.replies.push(error(409, "AMBIGUOUS", { candidateDocumentIds: ["doc-a", "doc-b"] }));
    const result = await run(["read", "dup.md"]);
    expect(result.code).toBe(4);
    expect(result.out).toContain("knowledge-hub read doc-a");
    expect(result.out).toContain("knowledge-hub read doc-b");
  });
});

describe("untrusted or failed answers", () => {
  beforeEach(async () => { await configure(); });

  it("exits 3 and prints nothing from the body when a 200 is HTML", async () => {
    hub.replies.push({ status: 200, raw: "<html>sign in</html>" });
    const document = await run(["read", "auth.md"]);
    expect(document.code).toBe(3);
    expect(document.out).not.toContain("sign in");
    expect(document.out).not.toContain("<html>");

    hub.replies.push({ status: 200, raw: "<html>sign in</html>" });
    const search = await run(["search", "auth"]);
    expect(search.code).toBe(3);
    expect(search.out).not.toContain("sign in");
  });

  it("exits 3 on a redirect and does not follow it", async () => {
    const elsewhere: string[] = [];
    const other = createServer((request, response) => {
      elsewhere.push(String(request.headers["x-knowledge-hub-export-token"]));
      response.end("stolen");
    });
    await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", resolve));
    const port = (other.address() as { port: number }).port;
    try {
      hub.replies.push({ status: 302, location: `http://127.0.0.1:${port}/steal` });
      const result = await run(["read", "auth.md"]);
      expect(result.code).toBe(3);
      expect(result.out).toMatch(/redirect/i);
      expect(elsewhere).toEqual([]);
    } finally {
      await new Promise<void>((resolve) => other.close(() => resolve()));
    }
  });

  it("exits 3 on a timeout", async () => {
    hub.replies.push("timeout");
    const result = await run(["search", "auth"]);
    expect(result.code).toBe(3);
    expect(result.out).toMatch(/No answer/i);
  });

  it.each([[401, 4], [403, 4], [413, 4], [422, 2], [503, 3]])("maps %i to exit %i", async (status, expected) => {
    hub.replies.push(error(status, "X"));
    expect((await run(["search", "auth"])).code).toBe(expected);
  });

  it("401 and 403 name configure --rotate", async () => {
    for (const status of [401, 403]) {
      hub.replies.push(error(status, "X"));
      const result = await run(["search", "auth"]);
      expect(result.code).toBe(4);
      expect(result.out).toContain(`knowledge-hub configure --rotate ${B1}`);
    }
  });

  it("never prints the token, on any path above", async () => {
    for (const reply of [
      hits([hit("doc-1", "Auth", null, "One.")]),
      error(401, "CREDENTIAL_INVALID"),
      error(409, "AMBIGUOUS", { candidateDocumentIds: ["doc-a"] }),
      error(404, "NOT_FOUND"),
      { status: 200, raw: "<html>sign in</html>" },
      error(503, "X"),
    ]) {
      hub.replies.push(reply);
      await run(["search", "auth"]);
    }
    hub.replies.push("timeout");
    await run(["read", "auth.md"]);
    // afterEach asserts every recorded output lacks the token.
    expect(outputs.every((output) => !output.includes(TOKEN))).toBe(true);
  });
});

describe("status", () => {
  it("status exits 0 when configured and contacts nothing", async () => {
    await configure();
    const result = await run(["status"]);
    expect(result.code).toBe(0);
    expect(result.out).toBe(`Configured: binding ${B1} at ${hub.url}.\n`);
    expect(hub.received).toHaveLength(0);
  });

  it("status exits 2 with the configure hint when not configured or the credential is missing", async () => {
    const missing = await run(["status"]);
    expect(missing.code).toBe(2);
    expect(missing.out).toContain("knowledge-hub configure");

    await configure();
    rmSync(path.join(home, ".config", "knowledge-hub", "credentials", `${B1}.json`));
    const noCredential = await run(["status"]);
    expect(noCredential.code).toBe(2);
    expect(noCredential.out).toContain(`knowledge-hub configure --rotate ${B1}`);
    expect(hub.received).toHaveLength(0);
  });

  it("status names the profile when it is not configured", async () => {
    const result = await run(["status", "--profile", "team"]);
    expect(result.code).toBe(2);
    expect(result.out).toContain("for profile team");
  });
});

describe("usage", () => {
  it("search with no words and read with zero or two refs are usage errors (exit 2)", async () => {
    expect((await run(["search"])).code).toBe(2);
    expect((await run(["read"])).code).toBe(2);
    expect((await run(["read", "one", "two"])).code).toBe(2);
    expect(hub.received).toHaveLength(0);
  });
});
