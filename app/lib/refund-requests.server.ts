import { and, eq } from "drizzle-orm";
import { db } from "~/db";
import { refundRequests, RefundRequestStatus } from "~/db/schema";

// Refund Eligibility = Refund Window + Watch-Time Limit + Completion Limit.
export const REFUND_WINDOW_DAYS = 14;
export const WATCH_TIME_LIMIT_SECONDS = 2 * 60 * 60;
export const COMPLETION_LIMIT = 0.5;

/**
 * The calendar day (YYYY-MM-DD, local time) a moment falls on. The Refund
 * Window is counted in whole days, not hours — a Purchase made at 23:00 still
 * gets the whole of its fourteenth day.
 */
export function toCalendarDay(when: Date): string {
  const year = when.getFullYear();
  const month = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The last calendar day of the Refund Window for a Purchase. */
export function lastDayOfRefundWindow(purchasedAtIso: string): string {
  const windowEnd = new Date(purchasedAtIso);
  windowEnd.setDate(windowEnd.getDate() + REFUND_WINDOW_DAYS);
  return toCalendarDay(windowEnd);
}

export function getPendingRefundRequest(purchaseId: number) {
  return db
    .select()
    .from(refundRequests)
    .where(
      and(
        eq(refundRequests.purchaseId, purchaseId),
        eq(refundRequests.status, RefundRequestStatus.Pending)
      )
    )
    .get();
}
