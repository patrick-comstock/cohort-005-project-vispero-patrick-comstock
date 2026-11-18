import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

import type { Db } from "~/db";
import { coupons, courses, purchases, refundRequests } from "~/db/schema";
import {
  hasRefundRequest,
  isTeamPurchase,
  makeRefundRequest,
  type RefundRequest,
  refundWindowEndedError,
} from "~/lib/refund-eligibility.server";
import {
  isWithinRefundWindow,
  lastDayOfRefundWindow,
} from "~/lib/refund-window";

/** Whether any of a Team Purchase's Coupons has been Redeemed. */
function hasRedeemedCoupon(database: Db, purchaseId: number) {
  const redeemed = database
    .select({ id: coupons.id })
    .from(coupons)
    .where(
      and(
        eq(coupons.purchaseId, purchaseId),
        isNotNull(coupons.redeemedByUserId)
      )
    )
    .get();
  return !!redeemed;
}

export type TeamPurchaseRefundRequestOffer =
  | {
      ok: true;
      purchase: typeof purchases.$inferSelect;
      amount: number;
      lastDayInWindow: string;
    }
  | {
      ok: false;
      code: "outside-refund-window";
      error: string;
      lastDay: string;
    }
  | {
      ok: false;
      code: Exclude<
        TeamPurchaseRefundRequestRefusalCode,
        "outside-refund-window"
      >;
      error: string;
    };

export type TeamPurchaseRefundRequestRefusalCode =
  | "not-found"
  | "not-buyer"
  | "not-team-purchase"
  | "already-requested"
  | "outside-refund-window"
  | "coupon-redeemed";

/**
 * The Refund Request a Team Purchase buyer may make for one Team Purchase, or
 * why they may not make one. The buyer has no Enrollment, so there are no
 * Watch-Time or Completion Limits: Refund Eligibility for a Team Purchase is
 * its Refund Window and none of its Coupons being Redeemed.
 */
export function getTeamPurchaseRefundRequestOffer(
  database: Db,
  input: { userId: number; purchaseId: number; now?: Date }
): TeamPurchaseRefundRequestOffer {
  const purchase = database
    .select()
    .from(purchases)
    .where(eq(purchases.id, input.purchaseId))
    .get();

  if (!purchase) {
    return { ok: false, code: "not-found", error: "Purchase not found." };
  }

  if (purchase.userId !== input.userId) {
    return {
      ok: false,
      code: "not-buyer",
      error:
        "Only the person who bought this Team Purchase can make a Refund Request for it.",
    };
  }

  if (!isTeamPurchase(database, purchase.id)) {
    return {
      ok: false,
      code: "not-team-purchase",
      error: "This Purchase is not a Team Purchase.",
    };
  }

  // A Purchase can have at most one Refund Request, ever (ADR 0002).
  if (hasRefundRequest(database, purchase.id)) {
    return {
      ok: false,
      code: "already-requested",
      error: "You have already made a Refund Request for this Team Purchase.",
    };
  }

  const lastDayInWindow = lastDayOfRefundWindow(purchase.createdAt);

  if (!isWithinRefundWindow(purchase.createdAt, input.now ?? new Date())) {
    return {
      ok: false,
      code: "outside-refund-window",
      error: refundWindowEndedError("Team Purchase", lastDayInWindow),
      lastDay: lastDayInWindow,
    };
  }

  // Approval Voids the Coupons; a Redeemed Coupon would keep its Enrollment,
  // so the Team Purchase can't be Refunded once any Coupon is Redeemed.
  if (hasRedeemedCoupon(database, purchase.id)) {
    return {
      ok: false,
      code: "coupon-redeemed",
      error: "Refunds aren't available once a Coupon has been Redeemed.",
    };
  }

  return {
    ok: true,
    purchase,
    // The Refund is always the full amount paid for the Purchase.
    amount: purchase.amountPaid,
    lastDayInWindow,
  };
}

/**
 * What a Team Purchase card on /team tells its buyer when there is no Refund
 * Request offer, or null to show nothing. An existing Refund Request shows its
 * status instead; the page lists only the buyer's own Team Purchases, so the
 * remaining refusals can't occur there.
 */
export function refusalReasonForTeamPurchaseBuyer(
  refusal: Extract<TeamPurchaseRefundRequestOffer, { ok: false }>
): string | null {
  switch (refusal.code) {
    case "outside-refund-window":
    case "coupon-redeemed":
      return refusal.error;
    case "already-requested":
    case "not-found":
    case "not-buyer":
    case "not-team-purchase":
      return null;
  }
}

/**
 * A Team Purchase buyer makes a Refund Request for one Team Purchase. The
 * offer is rechecked in the same transaction as the insert, and Redeeming
 * refuses a Coupon whose Team Purchase has a Pending Refund Request, so a
 * Coupon can't be Redeemed between the check and the Refund Request.
 */
export function makeTeamPurchaseRefundRequest(
  database: Db,
  input: { userId: number; purchaseId: number; reason: string; now?: Date }
):
  | { ok: true; refundRequest: RefundRequest; amount: number }
  | { ok: false; code: TeamPurchaseRefundRequestRefusalCode; error: string } {
  return database.transaction((tx) => {
    const offer = getTeamPurchaseRefundRequestOffer(tx, input);
    if (!offer.ok) return offer;

    const made = makeRefundRequest(tx, {
      purchaseId: offer.purchase.id,
      reason: input.reason,
    });
    if (!made.ok) {
      return { ok: false, code: "already-requested", error: made.error };
    }

    return {
      ok: true,
      refundRequest: made.refundRequest,
      amount: offer.amount,
    };
  });
}

/**
 * A buyer's Team Purchases, newest first, each with its Coupons, its Refund
 * Request if one was made, and the Refund Request offer for it.
 */
export function listTeamPurchasesForBuyer(
  database: Db,
  input: { userId: number; now?: Date }
) {
  const rows = database
    .select({
      purchaseId: purchases.id,
      purchasedAt: purchases.createdAt,
      amountPaid: purchases.amountPaid,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      couponCount: sql<number>`count(${coupons.id})`,
      redeemedCouponCount: sql<number>`count(${coupons.redeemedByUserId})`,
    })
    .from(purchases)
    .innerJoin(coupons, eq(coupons.purchaseId, purchases.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(eq(purchases.userId, input.userId))
    .groupBy(purchases.id)
    .orderBy(desc(purchases.createdAt), desc(purchases.id))
    .all();

  return rows.map((row) => {
    const refundRequest =
      database
        .select({
          status: refundRequests.status,
          refundAmount: refundRequests.refundAmount,
          resolutionNote: refundRequests.resolutionNote,
          requestedAt: refundRequests.requestedAt,
        })
        .from(refundRequests)
        .where(eq(refundRequests.purchaseId, row.purchaseId))
        .get() ?? null;

    const offer = getTeamPurchaseRefundRequestOffer(database, {
      userId: input.userId,
      purchaseId: row.purchaseId,
      now: input.now,
    });

    return {
      ...row,
      refundRequest,
      offer: offer.ok
        ? {
            ok: true as const,
            amount: offer.amount,
            lastDayInWindow: offer.lastDayInWindow,
          }
        : offer,
    };
  });
}
