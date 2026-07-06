import type { Settings } from "./settings.ts";

type Schedule = Settings["schedule"];

/** JS Sunday=0 → ISO Monday=1 … Sunday=7 */
export function isoWeekday(date: Date): number {
  return ((date.getDay() + 6) % 7) + 1;
}

function timeAsMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** True when an automatic generation should happen right now (catch-up included:
 *  any time after the scheduled time on an enabled day counts, as long as the
 *  issue doesn't exist yet). */
export function isDue(schedule: Schedule, now: Date, todayHasIssue: boolean): boolean {
  if (schedule.mode === "off") return false;
  if (todayHasIssue) return false;
  if (!schedule.days.includes(isoWeekday(now))) return false;
  return now.getHours() * 60 + now.getMinutes() >= timeAsMinutes(schedule.time);
}

/** The next scheduled fire time strictly after `now`, or null when disabled. */
export function nextRun(schedule: Schedule, now: Date): Date | null {
  if (schedule.mode === "off" || schedule.days.length === 0) return null;
  const [h, m] = schedule.time.split(":").map(Number);
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(now);
    candidate.setDate(candidate.getDate() + offset);
    candidate.setHours(h ?? 0, m ?? 0, 0, 0);
    if (candidate <= now) continue;
    if (schedule.days.includes(isoWeekday(candidate))) return candidate;
  }
  return null;
}

/** The latest scheduled fire time strictly before `now`, or null when disabled.
 *  Used as the news-freshness cutoff when no previous issue exists — e.g. a
 *  weekdays-only schedule makes Monday's paper cover the whole weekend. */
export function previousScheduledAt(schedule: Schedule, now: Date): Date | null {
  if (schedule.mode === "off" || schedule.days.length === 0) return null;
  const [h, m] = schedule.time.split(":").map(Number);
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(now);
    candidate.setDate(candidate.getDate() - offset);
    candidate.setHours(h ?? 0, m ?? 0, 0, 0);
    if (candidate >= now) continue;
    if (schedule.days.includes(isoWeekday(candidate))) return candidate;
  }
  return null;
}
