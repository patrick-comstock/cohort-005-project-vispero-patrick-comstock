import { and, eq } from "drizzle-orm";
import { coupons, enrollments, purchases } from "~/db/schema";
import { hasPendingRefundRequest, type Db } from "~/lib/refund-requests.server";

export type RedeemRefusalCode =
  | "not-found"
  | "voided"
  | "already-redeemed"
  | "refund-request-pending"
  | "already-enrolled"
  | "country-mismatch";

export const REFUND_REQUEST_PENDING_MESSAGE =
  "This Coupon can't be redeemed right now because its Team Purchase has a Pending Refund Request.";

export type RedeemResult =
  | { ok: true; enrollment: typeof enrollments.$inferSelect }
  | { ok: false; code: RedeemRefusalCode; error: string };

/**
 * A person Redeems a Coupon and is enrolled in its course. The checks and the
 * update run in one transaction, so a Coupon can't be Redeemed twice.
 */
export function redeemCoupon(
  database: Db,
  input: { code: string; userId: number; country: string }
): RedeemResult {
  return database.transaction((tx): RedeemResult => {
    const coupon = tx
      .select()
      .from(coupons)
      .where(eq(coupons.code, input.code))
      .get();

    if (!coupon) {
      return { ok: false, code: "not-found", error: "Coupon not found" };
    }

    if (coupon.voidedAt !== null) {
      return {
        ok: false,
        code: "voided",
        error: "This Coupon has been Voided",
      };
    }

    if (coupon.redeemedByUserId !== null) {
      return {
        ok: false,
        code: "already-redeemed",
        error: "Coupon has already been redeemed",
      };
    }

    // Approval would Void this Coupon but not end an Enrollment it created, so
    // no Coupon is Redeemed while its Team Purchase has a Pending Refund
    // Request. After a Decline, the Coupons can be Redeemed again.
    if (hasPendingRefundRequest(tx, coupon.purchaseId)) {
      return {
        ok: false,
        code: "refund-request-pending",
        error: REFUND_REQUEST_PENDING_MESSAGE,
      };
    }

    const existingEnrollment = tx
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.userId, input.userId),
          eq(enrollments.courseId, coupon.courseId)
        )
      )
      .get();

    if (existingEnrollment) {
      return {
        ok: false,
        code: "already-enrolled",
        error: "You are already enrolled in this course",
      };
    }

    const purchase = tx
      .select({ country: purchases.country })
      .from(purchases)
      .where(eq(purchases.id, coupon.purchaseId))
      .get();

    if (purchase?.country && purchase.country !== input.country) {
      return {
        ok: false,
        code: "country-mismatch",
        error:
          "This coupon can only be redeemed from the same country as the purchaser",
      };
    }

    tx.update(coupons)
      .set({
        redeemedByUserId: input.userId,
        redeemedAt: new Date().toISOString(),
      })
      .where(eq(coupons.id, coupon.id))
      .run();

    const enrollment = tx
      .insert(enrollments)
      .values({ userId: input.userId, courseId: coupon.courseId })
      .returning()
      .get();

    return { ok: true, enrollment };
  });
}
