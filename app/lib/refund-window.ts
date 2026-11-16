// ─── Refund Window ───
// The 14-day period after a Purchase during which a Refund Request may be
// made. Refund Eligibility and the analytics page's Refund exposure both judge
// it here, so they cannot drift apart.
//
// Days are UTC calendar days, so the answer never depends on the timezone of
// the machine asking. No database or request here: the analytics component
// imports REFUND_WINDOW_DAYS for its copy.

export const REFUND_WINDOW_DAYS = 14;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The UTC calendar day (YYYY-MM-DD) a moment falls on. The Refund Window is
 * counted in whole days, not hours — a Purchase made late in the day still
 * gets the whole of its fourteenth day.
 */
export function toCalendarDay(when: Date): string {
  return when.toISOString().slice(0, 10);
}

/** The last calendar day of the Refund Window for a Purchase. */
export function lastDayOfRefundWindow(purchasedAtIso: string): string {
  const windowEnd = new Date(purchasedAtIso);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + REFUND_WINDOW_DAYS);
  return toCalendarDay(windowEnd);
}

/**
 * Whether `now` falls in a Purchase's Refund Window, counting both ends. A
 * Purchase dated after today is not in its window yet.
 */
export function isWithinRefundWindow(purchasedAtIso: string, now: Date) {
  const today = toCalendarDay(now);
  return (
    today >= toCalendarDay(new Date(purchasedAtIso)) &&
    today <= lastDayOfRefundWindow(purchasedAtIso)
  );
}

/**
 * Whole days from today to the last day of a Purchase's Refund Window: 0 on
 * the last day itself, negative once the window has closed.
 */
export function daysLeftInRefundWindow(
  purchasedAtIso: string,
  now: Date
): number {
  const lastDay = Date.parse(
    `${lastDayOfRefundWindow(purchasedAtIso)}T00:00:00.000Z`
  );
  const today = Date.parse(`${toCalendarDay(now)}T00:00:00.000Z`);
  return Math.round((lastDay - today) / MS_PER_DAY);
}
