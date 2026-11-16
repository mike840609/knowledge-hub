import type { Pool } from "mariadb";
import { ContentTooLargeError } from "@/shared/domain/errors";

/**
 * A statement over the server's `max_allowed_packet` is not refused with an error: the server closes
 * the connection, and the driver reports only ECONNRESET, which reads as any network failure. So the
 * size is checked here, before sending, and refused with this error while the connection stays usable.
 * It is the shared domain error itself, so a write that reaches the pool directly, outside a unit of
 * work and `mapDatabaseError` (account drafts, feedback), is answered the same way: never a 500.
 */
export class PacketTooLargeError extends ContentTooLargeError {
  constructor(readonly bytes: number, readonly limit: number) {
    super();
    this.name = "PacketTooLargeError";
  }
}

/**
 * What the server accepts, once any connection has read it; undefined before that. Kept on
 * `globalThis` beside the pool (`database-pool.ts`): `next dev` re-evaluates this module on every
 * reload while the pool, and the guard that sets this, live on.
 */
const store = globalThis as typeof globalThis & { __khPacketLimit?: number };
export const knownPacketLimit = () => store.__khPacketLimit;
/** What a server's value is taken to be when it cannot be read as a size: MariaDB's default. */
const ASSUMED = 16 * 1024 * 1024;

// Counted as two bytes each: the characters any of the driver's escapers may write escaped. The
// connection's own writer escapes fewer (only ' " \ and NUL), so a newline-heavy statement is
// overestimated, by at most double; that is the margin, not a miscount.
const ESCAPED = new Set([0, 0x1a, 0x22, 0x27, 0x5c, 0x08, 0x0a, 0x0d, 0x09]);
// Room for the packet header and the server's own framing.
const HEADROOM = 1024;

function stringBytes(value: string): number {
  let escapes = 0;
  for (let i = 0; i < value.length; i++) if (ESCAPED.has(value.charCodeAt(i))) escapes++;
  return Buffer.byteLength(value) + escapes + 2;
}

function valueBytes(value: unknown): number {
  if (value === null || value === undefined) return 4;
  if (typeof value === "string") return stringBytes(value);
  if (typeof value === "bigint") return String(value).length;
  if (Buffer.isBuffer(value)) return value.length * 2 + 10;
  if (Array.isArray(value)) return value.reduce<number>((total, item) => total + valueBytes(item) + 2, 0);
  if (value instanceof Date) return 32;
  if (typeof value === "object" && typeof (value as { toSqlString?: unknown }).toSqlString === "function") return stringBytes(String((value as { toSqlString: () => unknown }).toSqlString()));
  if (typeof value === "object") return stringBytes(JSON.stringify(value));
  return 24;
}

/** The bytes a text-protocol statement occupies on the wire, never less than the driver sends. */
export function statementBytes(sql: unknown, values?: unknown): number {
  const options = typeof sql === "object" && sql !== null ? sql as { sql?: unknown; values?: unknown } : undefined;
  const text = typeof sql === "string" ? sql : String(options?.sql ?? "");
  const params = values ?? options?.values;
  return Buffer.byteLength(text) + (params === undefined ? 0 : valueBytes(params));
}

type Queryable = { query: (sql: never, values?: never) => Promise<unknown> };
type Run = (sql: unknown, values?: unknown) => Promise<unknown>;
type Limit = (run: Run) => Promise<number>;

/** Replaces `query` on the object itself, so a test that records or spies on it still sees every call. */
function guard<T extends Queryable>(target: T, limit: Limit): T {
  const run = (target.query as Run).bind(target);
  (target as unknown as { query: Run }).query = async (sql, values) => {
    const max = await limit(run);
    const bytes = statementBytes(sql, values);
    if (bytes > max - HEADROOM) throw new PacketTooLargeError(bytes, max);
    return run(sql, values);
  };
  return target;
}

/**
 * The pool, with every statement checked against what the server accepts. The limit is read once per
 * process (`SELECT @@max_allowed_packet`), unless `fixed` sets it (tests).
 * ponytail: checks text-protocol `query` only; nothing here uses `execute` or `batch`.
 */
export function guardPool(pool: Pool, fixed?: number): Pool {
  // Each caller reads through itself, the connection about to write: a transaction never waits on
  // a read that needs a second connection from the pool. Until one read lands, a few may overlap.
  const limit: Limit = async run => {
    if (fixed !== undefined) return fixed;
    if (store.__khPacketLimit !== undefined) return store.__khPacketLimit;
    const rows = await run("SELECT @@max_allowed_packet AS `limit`") as { limit: unknown }[];
    const read = Number(rows[0]?.limit);
    return (store.__khPacketLimit = Number.isSafeInteger(read) && read > 0 ? read : ASSUMED);
  };
  guard(pool, limit);
  const getConnection = pool.getConnection.bind(pool);
  // The driver hands out a new connection object each time, so each is guarded once.
  pool.getConnection = async () => guard(await getConnection(), limit);
  return pool;
}

/**
 * Bytes per multi-row INSERT: a quarter of what the server accepts, at most 4 MiB, so a batch's
 * estimate can be off by escaping and still fit.
 */
export function insertBudget(limit = knownPacketLimit()): number {
  return Math.min(4 * 1024 * 1024, Math.floor((limit ?? ASSUMED) / 4));
}

/**
 * The largest Markdown file an import can hold: a staged entry row carries the file twice (raw and
 * normalized), and escaping can double each copy.
 */
export function markdownFileCeiling(limit = knownPacketLimit()): number {
  return limit === undefined ? Number.POSITIVE_INFINITY : Math.floor((limit - 64 * 1024) / 4);
}
