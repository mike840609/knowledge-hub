import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_ARTIFACT_BYTES,
  MAX_REFERENCES,
  canonicalTaskHash,
  decodeTaskArtifactBody,
  parseTaskArtifact,
  parseTaskContent,
} from "@/modules/task-knowledge/domain/task-artifact";
import { TaskArtifactError } from "@/modules/task-knowledge/domain/task-errors";

const root = path.join(process.cwd(), "tests/fixtures/task-artifact");
const load = (file: string): Record<string, unknown> => JSON.parse(readFileSync(path.join(root, file), "utf8"));
const invalid = (dir: string) => readdirSync(path.join(root, dir)).filter((f) => f.endsWith(".json"));

function rejection(fn: () => unknown): TaskArtifactError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(TaskArtifactError);
    return error as TaskArtifactError;
  }
  throw new Error("expected a TaskArtifactError");
}

const minimal = load("content/valid-minimal.json");
const artifact = load("artifact/valid.json");

describe("task content contract", () => {
  it("accepts the minimal and full content fixtures", () => {
    expect(parseTaskContent(minimal)).toEqual(minimal);
    const full = load("content/valid-full.json");
    expect(parseTaskContent(full)).toEqual(full);
  });

  it.each(invalid("content/invalid"))("rejects content fixture %s", (file) => {
    rejection(() => parseTaskContent(load(`content/invalid/${file}`)));
  });

  it("rejects every CLI-owned and binding field in content", () => {
    for (const field of ["schemaVersion", "taskId", "artifactRevision", "bindingId"]) {
      const error = rejection(() => parseTaskContent({ ...minimal, [field]: 1 }));
      expect(error.message).toContain(field);
    }
  });

  it("rejects unknown keys instead of stripping them", () => {
    expect(() => parseTaskContent({ ...minimal, mood: "happy" })).toThrow(/mood/);
  });

  it("names a secret-named field but never echoes its value", () => {
    for (const file of ["secret-token", "secret-password", "secret-authorization"]) {
      const error = rejection(() => parseTaskContent(load(`content/invalid/${file}.json`)));
      expect(error.message).not.toContain("SECRETVALUE123");
      expect(error.message).toMatch(/token|password|Authorization/);
    }
  });

  it("keeps checks absent when omitted and never infers a pass", () => {
    const parsed = parseTaskContent({ ...minimal, verification: { status: "not_run" } });
    expect(parsed.verification).toEqual({ status: "not_run" });
    expect("checks" in parsed.verification).toBe(false);
  });

  it("accepts each real verification status", () => {
    for (const status of ["passed", "failed", "not_run", "not_applicable"]) {
      expect(parseTaskContent({ ...minimal, verification: { status } }).verification.status).toBe(status);
    }
  });

  it("accepts exactly the reference limit and rejects one more", () => {
    const refs = (n: number) => Array.from({ length: n }, (_, i) => ({ type: "COMMIT", id: `abc${i}def` }));
    expect(parseTaskContent({ ...minimal, references: refs(MAX_REFERENCES) }).references).toHaveLength(32);
    expect(MAX_REFERENCES).toBe(32);
    rejection(() => parseTaskContent({ ...minimal, references: refs(MAX_REFERENCES + 1) }));
  });

  it("rejects an oversized single string without truncating it", () => {
    rejection(() => parseTaskContent({ ...minimal, title: "x".repeat(201) }));
    rejection(() => parseTaskContent({ ...minimal, summary: "x".repeat(20_001) }));
    rejection(() => parseTaskContent({ ...minimal, findings: ["x".repeat(4001)] }));
  });
});

describe("task artifact contract", () => {
  it("accepts content plus the CLI-owned fields", () => {
    expect(parseTaskArtifact(artifact)).toEqual(artifact);
  });

  it.each(invalid("artifact/invalid"))("rejects artifact fixture %s", (file) => {
    rejection(() => parseTaskArtifact(load(`artifact/invalid/${file}`)));
  });

  it("names an unsupported schemaVersion with its own code", () => {
    expect(rejection(() => parseTaskArtifact({ ...artifact, schemaVersion: 2 })).code).toBe("UNSUPPORTED_SCHEMA_VERSION");
  });
});

describe("artifact body bounds", () => {
  const body = (text: string) => new TextEncoder().encode(text);

  it("parses a body at the byte limit", () => {
    const padded = JSON.stringify({ pad: "" });
    const exact = padded.replace('""', `"${"x".repeat(MAX_ARTIFACT_BYTES - padded.length)}"`);
    expect(body(exact).byteLength).toBe(MAX_ARTIFACT_BYTES);
    expect(decodeTaskArtifactBody(body(exact))).toHaveProperty("pad");
  });

  it("rejects a 65 KiB body by its UTF-8 bytes, not its characters", () => {
    expect(rejection(() => decodeTaskArtifactBody(body(JSON.stringify({ pad: "x".repeat(65 * 1024) })))).code).toBe(
      "PAYLOAD_TOO_LARGE",
    );
    const multibyte = JSON.stringify({ pad: "é".repeat(33_000) });
    expect(multibyte.length).toBeLessThan(MAX_ARTIFACT_BYTES);
    expect(rejection(() => decodeTaskArtifactBody(body(multibyte))).code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("reports malformed JSON with its own code", () => {
    expect(rejection(() => decodeTaskArtifactBody(body("{not json"))).code).toBe("MALFORMED_JSON");
    expect(rejection(() => decodeTaskArtifactBody(new Uint8Array([0xff, 0xfe]))).code).toBe("MALFORMED_JSON");
  });
});

describe("canonical task hash", () => {
  const parsed = parseTaskArtifact(artifact);

  it("is 64 lowercase hex characters", () => {
    expect(canonicalTaskHash(parsed)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ignores key order", () => {
    const reordered = Object.fromEntries(Object.entries(artifact).reverse());
    expect(canonicalTaskHash(parseTaskArtifact(reordered))).toBe(canonicalTaskHash(parsed));
  });

  it("changes when the summary changes", () => {
    expect(canonicalTaskHash(parseTaskArtifact({ ...artifact, summary: "Different." }))).not.toBe(canonicalTaskHash(parsed));
  });
});
