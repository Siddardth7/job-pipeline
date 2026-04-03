const MAX_STREAK_LOOKBACK_DAYS = 60;

/**
 * Parse any date string the app uses into a local-midnight Date.
 * Handles: "4/1/2026", "April 1, 2026", "2026-04-01", ISO timestamps.
 * Returns null if unparseable.
 */
function parseDate(dateStr) {
  if (!dateStr) return null;
  // ISO date-only strings (YYYY-MM-DD) are parsed as UTC midnight by the Date
  // constructor, which shifts them into the previous local day for UTC- zones.
  // Parse them as local midnight instead to avoid off-by-one errors.
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * True if dateStr represents the same local calendar day as targetDate.
 */
export function isSameLocalDay(dateStr, targetDate) {
  const d = parseDate(dateStr);
  if (!d) return false;
  return (
    d.getFullYear() === targetDate.getFullYear() &&
    d.getMonth()    === targetDate.getMonth()    &&
    d.getDate()     === targetDate.getDate()
  );
}

/**
 * Returns an array of 7 Date objects for the current Mon–Sun week.
 * Each date is midnight local time.
 */
export function getWeekDays() {
  const today = new Date();
  const dow = today.getDay(); // 0 = Sun
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  monday.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

/**
 * Calculates the current active streak in days.
 * A day counts if apps or networkingLog has an item whose `date` falls on that day.
 * Stops at the first gap (skips today-only gaps only on day 0).
 */
export function calcStreak(apps, networkingLog) {
  const today = new Date();
  let count = 0;
  for (let i = 0; i < MAX_STREAK_LOOKBACK_DAYS; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const active =
      apps.some(a => isSameLocalDay(a.date, d)) ||
      networkingLog.some(c => isSameLocalDay(c.date, d));
    if (active) {
      count++;
    } else if (i > 0) {
      break; // stop at first gap after today
    }
  }
  return count;
}

/**
 * Builds a sparkline data array of `days` length.
 * Each entry is the count of items whose `date` falls on that day.
 * Index 0 = oldest, index (days-1) = today.
 */
export function buildSparkData(items, days) {
  const today = new Date();
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (days - 1 - i));
    return items.filter(x => isSameLocalDay(x.date, d)).length;
  });
}
