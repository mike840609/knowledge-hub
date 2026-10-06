/** Daily activity uses Taipei calendar dates, independent of the server timezone. */
export function readingDate(date: Date): string {
  return new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}
export function readingDates(now: Date, days: number): string[] {
  const today = Date.parse(`${readingDate(now)}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => new Date(today - (days - 1 - i) * 86400000).toISOString().slice(0, 10));
}
export type ReadingActivity = {
  articles: number;
  activeDays: number;
  trackedSince: string | null;
  daily: { date: string; articles: number }[];
};
