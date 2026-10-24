const EXEMPT_EXACT = new Set(["/s", "/api/share-review", "/api/health"]);
const EXEMPT_PREFIXES = ["/s/", "/api/share-review/"];

/**
 * Share links are the product's public surface: their pages and the
 * token-gated review API must keep working for a recipient who has no site
 * password. The health route stays reachable so an uptime check and a cold
 * database wake do not need a secret.
 */
export function isSitePasswordExempt(pathname: string): boolean {
  return EXEMPT_EXACT.has(pathname) || EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

const encoder = new TextEncoder();

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

/**
 * HTTP Basic, password only. The username is ignored so any client's default
 * (or a password manager's) works; the password is the secret. Hashing both
 * sides makes the comparison length-independent before the constant-time loop.
 */
export async function verifySitePassword(authorization: string | null, password: string): Promise<boolean> {
  if (!password || !authorization) return false;
  const separator = authorization.indexOf(" ");
  if (separator < 0) return false;
  if (authorization.slice(0, separator).toLowerCase() !== "basic") return false;
  const encoded = authorization.slice(separator + 1).trim();
  if (!encoded) return false;
  let decoded: string;
  try {
    // atob returns one character per byte; the challenge advertises UTF-8, so
    // decode those bytes as UTF-8 or a non-ASCII password can never match.
    decoded = new TextDecoder().decode(Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)));
  } catch {
    return false;
  }
  const colon = decoded.indexOf(":");
  if (colon < 0) return false;
  const supplied = decoded.slice(colon + 1);
  const [left, right] = await Promise.all([digest(supplied), digest(password)]);
  return constantTimeEqual(left, right);
}
