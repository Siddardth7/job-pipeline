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
 * A day counts if apps or networkingLog has an item whose `date` starts with that day's ISO string.
 * Stops at the first gap (skips today-only gaps only on day 0).
 */
export function calcStreak(apps, networkingLog) {
  const today = new Date();
  let count = 0;
  for (let i = 0; i < 60; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const ds = d.toISOString().split('T')[0];
    const active =
      apps.some(a => a.date?.startsWith(ds)) ||
      networkingLog.some(c => c.date?.startsWith(ds));
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
 * Each entry is the count of items whose `date` matches that day.
 * Index 0 = oldest, index (days-1) = today.
 */
export function buildSparkData(items, days) {
  const today = new Date();
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (days - 1 - i));
    const ds = d.toISOString().split('T')[0];
    return items.filter(x => x.date?.startsWith(ds)).length;
  });
}
