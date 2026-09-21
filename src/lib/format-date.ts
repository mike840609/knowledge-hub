/**
 * Every date the UI renders is formatted here — which was not true of the
 * first version of this module. It swept up the four sites that spelled a
 * locale inline and missed three that did not: two identical copies of a
 * `toLocaleString()` helper in `source-list-row` and `import-history`, whose
 * output varies with the runtime's own locale rather than being merely wrong
 * in one place, and the audit list, which rendered a raw ISO string.
 *
 * The locale is one constant rather than the reader's browser locale on
 * purpose. These timestamps render on the server and again on the client, so
 * a locale that differs between the two is a hydration mismatch. Honouring
 * the reader's locale means resolving it on the server — from a header or a
 * stored preference — which is a product decision rather than a formatting
 * one. Until that decision is made the value is wrong in one place instead of
 * four, and switching it is a one-line change.
 */
export const UI_LOCALE = "en-US";

const dateTimeFormat = new Intl.DateTimeFormat(UI_LOCALE, { dateStyle: "medium", timeStyle: "short" });
const dateFormat = new Intl.DateTimeFormat(UI_LOCALE, { dateStyle: "medium" });

/** Medium date with a short time — the default for anything with an edit history. */
export function formatDateTime(value: Date): string {
  return dateTimeFormat.format(value);
}

/** Medium date alone, for columns where the time would not survive truncation. */
export function formatDate(value: Date): string {
  return dateFormat.format(value);
}

const relativeFormat = new Intl.RelativeTimeFormat(UI_LOCALE, { numeric: "auto" });

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/**
 * "3 minutes ago" for an elapsed duration in milliseconds, picking the
 * coarsest unit that still says something. Anything under a minute is not
 * worth a number.
 */
export function formatRelativeTime(elapsedMs: number): string {
  if (elapsedMs < MINUTE) return "just now";
  const unit = elapsedMs < HOUR ? "minute" : elapsedMs < DAY ? "hour" : "day";
  const step = unit === "minute" ? MINUTE : unit === "hour" ? HOUR : DAY;
  return relativeFormat.format(-Math.floor(elapsedMs / step), unit);
}
