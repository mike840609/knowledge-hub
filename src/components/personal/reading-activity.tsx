"use client";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import type { ReadingActivity } from "@/modules/personal/domain/reading-activity";
import { readingDate } from "@/modules/personal/domain/reading-activity";
import styles from "./profile.module.css";

export function ReadingActivityView({ activity, cumulative, total, days, periodControl }: { activity: ReadingActivity; cumulative: number; total: number; days: number; periodControl?: ReactNode }) {
  const [focusedDay, setFocusedDay] = useState(0);
  const activeIndex = Math.min(focusedDay, Math.max(0, activity.daily.length - 1));
  function navigate(event: KeyboardEvent<HTMLDivElement>, index: number) {
    const next = event.key === "ArrowRight" ? Math.min(activity.daily.length - 1, index + 1) : event.key === "ArrowLeft" ? Math.max(0, index - 1) : event.key === "Home" ? 0 : event.key === "End" ? activity.daily.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    setFocusedDay(next);
    event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[data-reading-day]')[next]?.focus();
  }
  const firstTracked = activity.trackedSince ? readingDate(new Date(activity.trackedSince)) : null;
  const hasUntrackedDays = activity.daily.some(day => firstTracked === null || day.date < firstTracked);
  const rawMax = Math.max(1, ...activity.daily.map(day => day.articles));
  // A round ceiling reads as a scale; the exact maximum reads as a data point.
  const max = rawMax <= 10 ? rawMax : Math.ceil(rawMax / 10) * 10;
  const format = (date: string) => new Intl.DateTimeFormat("en-US", {month:"short",day:"numeric",timeZone:"UTC"}).format(new Date(`${date}T00:00:00Z`));
  return <section className={styles.activity} aria-labelledby="reading-activity">
    <div className={styles.sectionhead}><h2 className={styles.sectiontitle} id="reading-activity">Reading activity</h2>{periodControl}</div>
    <dl className={styles.readingMetrics}>
      <div><dt>Documents viewed (this period)</dt><dd data-period-articles={activity.articles}>{activity.articles}<span> distinct documents</span></dd></div>
      <div><dt>Active days</dt><dd>{activity.activeDays}<span> of {days} days</span></dd></div>
      <div className={styles.readingTotal} data-browsed-count={cumulative}><dt>Viewed in your current library</dt><dd>{cumulative}<span> of {total} documents, all time</span></dd></div>
    </dl>
    <p className="sr-only" id="reading-chart-help">Use left and right arrow keys to explore daily document views.</p>
    <div className={styles.readingPlot}>
    <div className={styles.readingScale} aria-hidden="true"><span>{max}</span><span>{Math.round(max / 2)}</span><span>0</span></div>
    <div className={styles.readingChart} aria-label={`Daily documents viewed, scale 0 to ${max} documents`} aria-describedby="reading-chart-help">
      {activity.daily.map((day, index) => {
        const tracked = firstTracked !== null && day.date >= firstTracked;
        const label = `${format(day.date)}: ${tracked ? `${day.articles} ${day.articles === 1 ? "document" : "documents"} viewed` : "Not tracked"}`;
        return <Tooltip key={day.date} label={label} side="top"><div data-reading-day tabIndex={index === activeIndex ? 0 : -1} onFocus={() => setFocusedDay(index)} onKeyDown={event => navigate(event,index)} role="img" aria-label={label} className={`${styles.readingColumn} kh-focus-ring`}>
          <span aria-hidden="true" className={tracked ? styles.readingBar : styles.readingUntracked} style={{height:tracked && day.articles > 0 ? `${Math.max(10,day.articles / max * 100)}%` : "2px"}} />
        </div></Tooltip>;
      })}
    </div>
    <div className={styles.readingAxis} aria-hidden="true">{activity.daily.map((day, index) => <span key={day.date} className={`whitespace-nowrap ${index % (activity.daily.length <= 7 ? 1 : Math.ceil(activity.daily.length / 6)) === 0 || index === activity.daily.length - 1 ? "" : "invisible"}`}>{format(day.date)}</span>)}</div>
    </div>
    <p className={styles.small}>{activity.articles === 0 ? "No document views recorded in this period. " : "Daily documents viewed, including today. "}Taipei time (UTC+8).</p>
    {hasUntrackedDays ? <p className={styles.small}>{firstTracked ? `Tracking started ${firstTracked}; earlier dates are not tracked.` : "Daily tracking has not started yet."}</p> : null}
  </section>;
}
