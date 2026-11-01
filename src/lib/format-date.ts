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

/** A zh-TW formatter for the one Chinese surface; the same caching and fallback as `formatter`. */
function zhFormatter(
  cache: Map<string, Intl.DateTimeFormat>,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const cached = cache.get(timeZone);
  if (cached) return cached;
  let built: Intl.DateTimeFormat;
  try {
    built = new Intl.DateTimeFormat("zh-TW", { ...options, timeZone });
  } catch {
    built = new Intl.DateTimeFormat("zh-TW", { ...options, timeZone: SSR_TIME_ZONE });
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

const yearFormats = new Map<string, Intl.DateTimeFormat>();
const monthDayFormats = new Map<string, Intl.DateTimeFormat>();
const WEEK = 7 * DAY;

/**
 * "5m", "23h", "6d", then "Oct 12" — a list column's time, as compact as the
 * row it sits in. Past a week the date says more than a count of days; the
 * year appears only when it is not this one.
 */
export function formatShortTime(value: Date, now: number, timeZone: string): string {
  const elapsed = Math.max(0, now - value.getTime());
  if (elapsed < MINUTE) return "now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d`;
  const year = formatter(yearFormats, timeZone, { year: "numeric" });
  if (year.format(value) !== year.format(new Date(now))) return formatDate(value, timeZone);
  return formatter(monthDayFormats, timeZone, { month: "short", day: "numeric" }).format(value);
}

/**
 * The same compact relative time in Traditional Chinese, for the one surface
 * that is Chinese throughout: a team publication's update line. The locale is
 * a constant here too, so the server and client first render agree.
 */
export function formatRelativeTimeZhTw(elapsedMs: number): string {
  if (elapsedMs < MINUTE) return "剛剛";
  if (elapsedMs < HOUR) return `${Math.floor(elapsedMs / MINUTE)} 分鐘前`;
  if (elapsedMs < DAY) return `${Math.floor(elapsedMs / HOUR)} 小時前`;
  return `${Math.floor(elapsedMs / DAY)} 天前`;
}

const zhMonthDayFormats = new Map<string, Intl.DateTimeFormat>();
const zhYearFormats = new Map<string, Intl.DateTimeFormat>();
const zhYearMonthDayFormats = new Map<string, Intl.DateTimeFormat>();

/** 「剛剛」「6 天前」「10/12」: relative inside a week, then the month and day. */
export function formatShortTimeZhTw(value: Date, now: number, timeZone: string): string {
  if (Math.max(0, now - value.getTime()) < WEEK) {
    return formatRelativeTimeZhTw(Math.max(0, now - value.getTime()));
  }
  const year = zhFormatter(zhYearFormats, timeZone, { year: "numeric" });
  const sameYear = year.format(value) === year.format(new Date(now));
  return sameYear
    ? zhFormatter(zhMonthDayFormats, timeZone, { month: "numeric", day: "numeric" }).format(value)
    : zhFormatter(zhYearMonthDayFormats, timeZone, { year: "numeric", month: "numeric", day: "numeric" }).format(value);
}

