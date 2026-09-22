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
 * a locale that differs between the two is a hydration mismatch.
 *
 * **The zone is not defaulted, it is demanded.** Leaving it to the runtime is
 * what the earlier version did, and it is why a reader in Asia/Taipei was
 * shown UTC on the Sources list, in search results and in the audit log: those
 * three render on the server, so the server's zone is what reached the page
 * and stayed there. Making the parameter required means a new call site cannot
 * inherit that bug by omission — it has to say which zone it means, and the
 * only place that can answer "the reader's" is a client component after it has
 * mounted. `components/ui/timestamp.tsx` is that place.
 */
export const UI_LOCALE = "en-US";

/**
 * The zone the server and the first client render agree on.
 *
 * It has to be an explicit zone rather than the runtime's, or the two renders
 * disagree and React tears the markup. UTC is the one zone both sides can
 * compute without knowing anything about the reader.
 */
export const SSR_TIME_ZONE = "UTC";

const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();

function formatter(
  cache: Map<string, Intl.DateTimeFormat>,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const cached = cache.get(timeZone);
  if (cached) return cached;
  // An unknown zone throws; a reader whose browser reports something this
  // runtime's ICU does not know is better served by UTC than by a blank page.
  let built: Intl.DateTimeFormat;
  try {
    built = new Intl.DateTimeFormat(UI_LOCALE, { ...options, timeZone });
  } catch {
    built = new Intl.DateTimeFormat(UI_LOCALE, { ...options, timeZone: SSR_TIME_ZONE });
  }
  cache.set(timeZone, built);
  return built;
}

/** Medium date with a short time — the default for anything with an edit history. */
export function formatDateTime(value: Date, timeZone: string): string {
  return formatter(dateTimeFormats, timeZone, { dateStyle: "medium", timeStyle: "short" }).format(value);
}

/** Medium date alone, for columns where the time would not survive truncation. */
export function formatDate(value: Date, timeZone: string): string {
  return formatter(dateFormats, timeZone, { dateStyle: "medium" }).format(value);
}

const relativeFormat = new Intl.RelativeTimeFormat(UI_LOCALE, { numeric: "auto" });

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/**
 * "3 minutes ago" for an elapsed duration in milliseconds, picking the
 * coarsest unit that still says something. Anything under a minute is not
 * worth a number.
 *
 * An elapsed duration has no zone, which is why this one takes none.
 */
export function formatRelativeTime(elapsedMs: number): string {
  if (elapsedMs < MINUTE) return "just now";
  const unit = elapsedMs < HOUR ? "minute" : elapsedMs < DAY ? "hour" : "day";
  const step = unit === "minute" ? MINUTE : unit === "hour" ? HOUR : DAY;
  return relativeFormat.format(-Math.floor(elapsedMs / step), unit);
}
