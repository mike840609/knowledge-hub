import type { Pool } from "mariadb";

/**
 * A statement over the server's `max_allowed_packet` is not refused with an error: the server closes
 * the connection, and the driver reports only ECONNRESET, which reads as any network failure. So the
 * size is checked here, before sending, and refused with this error while the connection stays usable.
 */
export class PacketTooLargeError extends Error {
  readonly code = "ER_NET_PACKET_TOO_LARGE";
  constructor(readonly bytes: number, readonly limit: number) {
    super(`A ${bytes}-byte statement exceeds the database's max_allowed_packet of ${limit} bytes.`);
    this.name = "PacketTooLargeError";
  }
}

/** What the server accepts, once any connection has read it; undefined before that. */
let known: number | undefined;
export const knownPacketLimit = () => known;

// The characters the driver's text protocol escapes, each sent as two bytes (mariadb lib/misc/utils.js).
const ESCAPED = /[\0\x1a"'\\\b\n\r\t]/g;
// Room for the packet header and the server's own framing.
const HEADROOM = 1024;

function valueBytes(value: unknown): number {
  if (value === null || value === undefined) return 4;
  if (typeof value === "string") return Buffer.byteLength(value) + (value.match(ESCAPED)?.length ?? 0) + 2;
  if (Buffer.isBuffer(value)) return value.length * 2 + 10;
  if (Array.isArray(value)) return value.reduce<number>((total, item) => total + valueBytes(item) + 2, 0);
  if (value instanceof Date) return 32;
  if (typeof value === "object") return valueBytes(JSON.stringify(value));
  return 24;
}

/** The bytes a text-protocol statement occupies on the wire, never less than the driver sends. */
export function statementBytes(sql: unknown, values?: unknown): number {
  const text = typeof sql === "string" ? sql : typeof sql === "object" && sql !== null && "sql" in sql ? String((sql as { sql: unknown }).sql) : "";
  return Buffer.byteLength(text) + (values === undefined ? 0 : valueBytes(values));
}

type Queryable = { query: (sql: never, values?: never) => Promise<unknown> };
type Run = (sql: unknown, values?: unknown) => Promise<unknown>;
type Limit = (run: Run) => Promise<number>;

/** Replaces `query` on the object itself, so a test that records or spies on it still sees every call. */
function guard<T extends Queryable>(target: T, limit: Limit, mark: symbol): T {
  const marked = target as unknown as Record<symbol, true>;
  if (marked[mark]) return target; // a pooled connection handed out again
  const run = (target.query as Run).bind(target);
  (target as unknown as { query: Run }).query = async (sql, values) => {
    // Read through this same connection: a transaction never waits on a second one from the pool.
    const max = await limit(run);
    const bytes = statementBytes(sql, values);
    if (bytes > max - HEADROOM) throw new PacketTooLargeError(bytes, max);
    return run(sql, values);
  };
  marked[mark] = true;
  return target;
}

/**
 * The pool, with every statement checked against what the server accepts. The limit is read once per
 * process (`SELECT @@max_allowed_packet`), unless `fixed` sets it (tests).
 * ponytail: checks text-protocol `query` only; nothing here uses `execute` or `batch`.
 */
export function guardPool(pool: Pool, fixed?: number): Pool {
  let reading: Promise<number> | undefined;
  const limit: Limit = run => fixed !== undefined ? Promise.resolve(fixed) : known !== undefined ? Promise.resolve(known) : (reading ??= run("SELECT @@max_allowed_packet AS `limit`")
    .then(rows => (known = Number((rows as { limit: unknown }[])[0]?.limit)), error => { reading = undefined; throw error; }));
  const mark = Symbol("packet-limit");
  guard(pool, limit, mark);
  const getConnection = pool.getConnection.bind(pool);
  pool.getConnection = async () => guard(await getConnection(), limit, mark);
  return pool;
}

/**
 * Bytes per multi-row INSERT: a quarter of what the server accepts, at most 4 MiB, so a batch's
 * estimate can be off by escaping and still fit.
 */
export function insertBudget(limit = known): number {
  return Math.min(4 * 1024 * 1024, Math.floor((limit ?? 16 * 1024 * 1024) / 4));
}

/**
 * The largest Markdown file an import can hold: a staged entry row carries the file twice (raw and
 * normalized), and escaping can double each copy.
 */
export function markdownFileCeiling(limit = known): number {
  return limit === undefined ? Number.POSITIVE_INFINITY : Math.floor((limit - 64 * 1024) / 4);
}
