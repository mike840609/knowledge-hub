import { createHash, createHmac } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { BlobMismatchError, type BlobBody, type BlobStore } from "@/modules/sources/ports/blob-store";

export type S3Config = {
  /** `http(s)://host[:port]`, for example a MinIO service. Addressed path-style: `<endpoint>/<bucket>/<key>`. */
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  region: string;
  /** Empty, or a folder inside the bucket ending in `/`, so several deployments can share one bucket. */
  prefix: string;
};

/** A response from the store that was not the expected one. Carries no credentials and no object content. */
export class S3RequestError extends Error {
  constructor(readonly operation: string, readonly status: number, readonly code: string | null) {
    super(`Image storage (S3) ${operation} failed: HTTP ${status}${code ? ` ${code}` : ""}.`);
    this.name = "S3RequestError";
  }
}

const SHA256 = /^[0-9a-f]{64}$/;
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const sha256Hex = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const hmac = (key: string | Buffer, value: string) => createHmac("sha256", key).update(value, "utf8").digest();
/** RFC 3986, as Signature Version 4 requires: `encodeURIComponent` leaves `!'()*` alone. */
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
const encodePath = (path: string) => path.split("/").map(encode).join("/");
const unescapeXml = (value: string) => value.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[name]!);

/**
 * AWS Signature Version 4 for S3, single-chunk payload. `headers` must hold
 * every header to sign, lower-cased, including `host`, `x-amz-date` and
 * `x-amz-content-sha256`. Returns the `Authorization` header.
 */
export function signS3Request(input: {
  method: string;
  /** The URI path, already percent-encoded. */
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  region: string;
  accessKey: string;
  secretKey: string;
}): string {
  const names = Object.keys(input.headers).sort();
  const query = Object.keys(input.query).sort().map((name) => `${encode(name)}=${encode(input.query[name])}`).join("&");
  const canonical = [
    input.method, input.path, query,
    names.map((name) => `${name}:${input.headers[name].trim()}\n`).join(""),
    names.join(";"),
    input.headers["x-amz-content-sha256"],
  ].join("\n");
  const timestamp = input.headers["x-amz-date"];
  const scope = `${timestamp.slice(0, 8)}/${input.region}/s3/aws4_request`;
  const key = ["s3", "aws4_request"].reduce<Buffer>((current, part) => hmac(current, part), hmac(hmac(`AWS4${input.secretKey}`, timestamp.slice(0, 8)), input.region));
  const signature = hmac(key, ["AWS4-HMAC-SHA256", timestamp, scope, sha256Hex(canonical)].join("\n")).toString("hex");
  return `AWS4-HMAC-SHA256 Credential=${input.accessKey}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
}

async function text(response: http.IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of response) body += (chunk as Buffer).toString("utf8");
  return body;
}
const errorCode = (body: string) => /<Code>([^<]+)<\/Code>/.exec(body)?.[1] ?? null;

/**
 * Image bytes in an S3-compatible bucket (MinIO, or any service that speaks
 * the S3 API with path-style addressing). The object key is the content's
 * SHA-256, and S3's signed payload hash is that same value, so the store
 * itself refuses bytes that do not match the key.
 */
export class S3BlobStore implements BlobStore {
  private readonly url: URL;

  constructor(private readonly config: S3Config, private readonly now: () => Date = () => new Date()) {
    this.url = new URL(config.endpoint);
  }

  private key(sha256: string): string {
    if (!SHA256.test(sha256)) throw new Error("A blob key is a lowercase hex SHA-256.");
    return `${this.config.prefix}sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
  }

  private send(method: string, objectKey: string | null, options: { query?: Record<string, string>; payloadHash?: string; contentLength?: number } = {}) {
    const query = options.query ?? {};
    const path = `${this.url.pathname.replace(/\/+$/, "")}/${encode(this.config.bucket)}${objectKey === null ? "" : `/${encodePath(objectKey)}`}`;
    const headers: Record<string, string> = {
      host: this.url.host,
      "x-amz-content-sha256": options.payloadHash ?? EMPTY_SHA256,
      "x-amz-date": this.now().toISOString().replace(/[-:]|\.\d{3}/g, ""),
    };
    const authorization = signS3Request({ method, path, query, headers, region: this.config.region, accessKey: this.config.accessKey, secretKey: this.config.secretKey });
    const search = Object.keys(query).sort().map((name) => `${encode(name)}=${encode(query[name])}`).join("&");
    const request = (this.url.protocol === "https:" ? https : http).request({
      protocol: this.url.protocol, hostname: this.url.hostname, port: this.url.port || undefined, method,
      path: search ? `${path}?${search}` : path,
      headers: { ...headers, authorization, ...(options.contentLength === undefined ? {} : { "content-length": String(options.contentLength) }) },
    });
    const response = new Promise<http.IncomingMessage>((resolve, reject) => { request.on("response", resolve); request.on("error", reject); });
    return { request, response };
  }

  private async call(method: string, objectKey: string | null, query?: Record<string, string>): Promise<{ status: number; response: http.IncomingMessage }> {
    const { request, response } = this.send(method, objectKey, { query });
    request.end();
    const received = await response;
    return { status: received.statusCode ?? 0, response: received };
  }

  async put(sha256: string, body: BlobBody, expectedSize: number): Promise<void> {
    const { request, response } = this.send("PUT", this.key(sha256), { payloadHash: sha256, contentLength: expectedSize });
    // The pipeline reports a failed upload; this only keeps a second rejection from going unhandled.
    response.catch(() => {});
    const hash = createHash("sha256");
    let size = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        size += chunk.length;
        if (size > expectedSize) return done(new BlobMismatchError());
        hash.update(chunk);
        done(null, chunk);
      },
      // Before the request is ended: a mismatch aborts it, and the store never completes the object.
      flush(done) { done(size !== expectedSize || hash.digest("hex") !== sha256 ? new BlobMismatchError() : null); },
    });
    try {
      await pipeline(Readable.fromWeb(body as never), meter, request);
    } catch (error) {
      request.destroy();
      throw error;
    }
    const received = await response;
    const answer = await text(received);
    if (received.statusCode === 200) return;
    const code = errorCode(answer);
    // The store checked the bytes against the signed payload hash and disagreed.
    if (code === "XAmzContentSHA256Mismatch" || code === "BadDigest" || code === "IncompleteBody") throw new BlobMismatchError();
    throw new S3RequestError("PUT", received.statusCode ?? 0, code);
  }

  async open(sha256: string): Promise<{ body: BlobBody; size: number } | null> {
    const { status, response } = await this.call("GET", this.key(sha256));
    if (status === 200) return { body: Readable.toWeb(response) as unknown as BlobBody, size: Number(response.headers["content-length"]) };
    const code = errorCode(await text(response));
    if (status === 404) return null;
    throw new S3RequestError("GET", status, code);
  }

  async has(sha256: string): Promise<boolean> {
    const { status, response } = await this.call("HEAD", this.key(sha256));
    response.resume();
    if (status === 200) return true;
    if (status === 404) return false;
    throw new S3RequestError("HEAD", status, null);
  }

  async remove(sha256: string): Promise<void> {
    const { status, response } = await this.call("DELETE", this.key(sha256));
    const code = errorCode(await text(response));
    if (status !== 204 && status !== 200 && status !== 404) throw new S3RequestError("DELETE", status, code);
  }

  async *list(): AsyncIterable<{ sha256: string; modifiedAt: Date }> {
    let token: string | undefined;
    do {
      const { status, response } = await this.call("GET", null, { "list-type": "2", prefix: `${this.config.prefix}sha256/`, ...(token ? { "continuation-token": token } : {}) });
      const body = await text(response);
      if (status !== 200) throw new S3RequestError("LIST", status, errorCode(body));
      for (const [, contents] of body.matchAll(/<Contents>(.*?)<\/Contents>/gs)) {
        const name = /<Key>([^<]*)<\/Key>/.exec(contents)?.[1].split("/").pop() ?? "";
        const modified = /<LastModified>([^<]*)<\/LastModified>/.exec(contents)?.[1];
        if (SHA256.test(name) && modified) yield { sha256: name, modifiedAt: new Date(modified) };
      }
      const next = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(body)?.[1];
      token = next ? unescapeXml(next) : undefined;
    } while (token);
  }

  /** Reaches the bucket with these credentials, or throws: an `S3RequestError` when the store answered and refused. */
  async check(): Promise<void> {
    const { status, response } = await this.call("GET", null, { "list-type": "2", "max-keys": "1" });
    const body = await text(response);
    if (status !== 200) throw new S3RequestError("bucket check", status, errorCode(body));
  }

  /** For local development and tests; a company bucket is created by whoever runs the store. */
  async createBucket(): Promise<void> {
    const { request, response } = this.send("PUT", null, { contentLength: 0 });
    request.end();
    const received = await response;
    const code = errorCode(await text(received));
    if (received.statusCode !== 200 && code !== "BucketAlreadyOwnedByYou" && code !== "BucketAlreadyExists") throw new S3RequestError("create bucket", received.statusCode ?? 0, code);
  }
}
