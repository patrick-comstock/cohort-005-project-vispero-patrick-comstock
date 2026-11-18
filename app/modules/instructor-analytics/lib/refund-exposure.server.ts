import { and, eq, isNull } from "drizzle-orm";

import type { Db } from "~/db";
import { courses, purchases, refundRequests } from "~/db/schema";
import { splitRevenue } from "~/lib/analytics";
import { type AnalyticsScope, scopeOn } from "~/lib/analytics-scope.server";
import {
  daysLeftInRefundWindow,
  isWithinRefundWindow,
} from "~/lib/refund-window";
import { resolvedRefundRequest } from "~/lib/revenue.server";

// ─── Refund exposure ───
// Revenue is reported the moment a Purchase lands, but a Refund Request can be
// made for fourteen days, so some of what this page calls Revenue is still the
// learner's money. This panel says how much of it is. Purchases already
// Refunded are out of Revenue, so they are not exposed either. Nor are
// Purchases whose Refund Request was Declined: a Resolution is final and a
// Purchase has at most one Refund Request, so that money is kept. A Pending
// Refund Request still counts as exposed. The Refund Window is judged exactly
// as Refund Eligibility judges it, so a Purchase dated after today is not
// exposed either.

type ExposedCourse = {
  courseId: number;
  title: string;
  revenueCents: number;
  purchaseCount: number;
  /** Days left for its most urgent Purchase; 0 means the window closes today. */
  daysLeft: number;
};

export type RefundExposure = {
  revenueCents: number;
  netEarningsCents: number;
  purchaseCount: number;
  /** Exposed Revenue as a share of the period's Revenue. */
  sharePercent: number;
  closingTodayCount: number;
  courses: ExposedCourse[];
};

export function getRefundExposure(
  database: Db,
  scope: AnalyticsScope,
  revenueCents: number
): RefundExposure {
  // Every Purchase in the range with no Resolved Refund Request (none, or one
  // still Pending), then the ones inside their Refund Window, grouped up.
  const rows = database
    .select({
      courseId: courses.id,
      title: courses.title,
      amountPaid: purchases.amountPaid,
      createdAt: purchases.createdAt,
    })
    .from(purchases)
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .leftJoin(refundRequests, resolvedRefundRequest)
    .where(
      and(
        scopeOn(
          purchases.createdAt,
          scope.instructorId,
          scope.range,
          scope.now
        ),
        isNull(refundRequests.id)
      )
    )
    .all();

  const exposedByCourse = new Map<number, ExposedCourse>();
  let exposedRevenueCents = 0;
  let exposedPurchaseCount = 0;
  let closingTodayCount = 0;

  for (const row of rows) {
    if (!isWithinRefundWindow(row.createdAt, scope.now)) continue;
    const daysLeft = daysLeftInRefundWindow(row.createdAt, scope.now);

    // Not Refunded, so all of what was paid is still in Revenue.
    exposedRevenueCents += row.amountPaid;
    exposedPurchaseCount += 1;
    if (daysLeft === 0) closingTodayCount += 1;

    const existing = exposedByCourse.get(row.courseId);

    if (existing === undefined) {
      exposedByCourse.set(row.courseId, {
        courseId: row.courseId,
        title: row.title,
        revenueCents: row.amountPaid,
        purchaseCount: 1,
        daysLeft,
      });
    } else {
      existing.revenueCents += row.amountPaid;
      existing.purchaseCount += 1;
      // The course's headline is its most urgent purchase, not its newest.
      existing.daysLeft = Math.min(existing.daysLeft, daysLeft);
    }
  }

  return {
    revenueCents: exposedRevenueCents,
    netEarningsCents: splitRevenue(exposedRevenueCents).netEarningsCents,
    purchaseCount: exposedPurchaseCount,
    sharePercent:
      revenueCents === 0
        ? 0
        : Math.round((exposedRevenueCents / revenueCents) * 100),
    closingTodayCount,
    courses: [...exposedByCourse.values()].sort(
      (a, b) => b.revenueCents - a.revenueCents
    ),
  };
}
