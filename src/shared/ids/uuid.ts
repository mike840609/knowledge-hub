/**
 * The UUID shape check on its own, with no `node:crypto` beside it: domain
 * modules that only validate an id can be imported by browser code too.
 * Anything that needs to mint one belongs in `./uuidv7`.
 */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
