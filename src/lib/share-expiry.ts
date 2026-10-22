/** From this many days left, a shared page says how soon its link stops opening. */
export const EXPIRY_SOON_DAYS = 3;

const DAY = 24 * 60 * 60 * 1000;

/** How soon the link expires, in words, once it is within `EXPIRY_SOON_DAYS`; before that, nothing. */
export function expiresSoon(expiresAt: Date | string, now: Date): string | null {
  const left = new Date(expiresAt).getTime() - now.getTime();
  if (left > EXPIRY_SOON_DAYS * DAY) return null;
  if (left <= DAY) return "in less than a day";
  const days = Math.ceil(left / DAY);
  return `in ${days} days`;
}
