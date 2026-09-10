import { randomBytes } from "node:crypto";

let lastTimestamp = -1;
let lastRandom: Uint8Array | undefined;

/** Generate an RFC 9562 UUIDv7 string without relying on database-side randomness. */
export function uuidv7(now = Date.now()): string {
  if (!Number.isSafeInteger(now) || now < 0 || now > 0xffffffffffff) {
    throw new RangeError("UUIDv7 timestamp must be a non-negative millisecond timestamp.");
  }
  const timestamp = now;
  let random = randomBytes(10);
  if (timestamp === lastTimestamp && lastRandom) {
    random = Buffer.from(lastRandom);
    for (let index = random.length - 1; index >= 0; index -= 1) {
      random[index] = (random[index] + 1) & 0xff;
      if (random[index] !== 0) break;
    }
  } else {
    lastTimestamp = timestamp;
  }
  lastRandom = Uint8Array.from(random);

  const bytes = Buffer.alloc(16);
  let remaining = timestamp;
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  random.copy(bytes, 6, 0, 10);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
