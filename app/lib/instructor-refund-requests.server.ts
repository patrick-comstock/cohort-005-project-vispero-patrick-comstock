import { and, asc, eq, exists, type SQL } from "drizzle-orm";
import {
  coupons,
  courses,
  users,
  purchases,
  refundRequests,
  RefundRequestStatus,
} from "~/db/schema";
import type { Db } from "~/db";

/**
 * The read-only view of Refund Requests for the people who teach a course.
 * Pass an Instructor's id to see only their own courses, or null (Admins) to
 * see every course. Only Admins Resolve; this view never offers it.
 */
export function listInstructorRefundRequests(
  database: Db,
  instructorId: number | null
) {
  const conditions: SQL[] = [];
  if (instructorId !== null) {
    conditions.push(eq(courses.instructorId, instructorId));
  }

  const rows = database
    .select({
      id: refundRequests.id,
      status: refundRequests.status,
      reason: refundRequests.reason,
      resolutionNote: refundRequests.resolutionNote,
      requestedAt: refundRequests.requestedAt,
      resolvedAt: refundRequests.resolvedAt,
      purchasedAt: purchases.createdAt,
      requesterName: users.name,
      requesterEmail: users.email,
      courseTitle: courses.title,
      // A Team Purchase is a Purchase with Coupons; its buyer is shown.
      isTeamPurchase: exists(
        database
          .select({ id: coupons.id })
          .from(coupons)
          .where(eq(coupons.purchaseId, purchases.id))
      ).mapWith(Boolean),
    })
    .from(refundRequests)
    .innerJoin(purchases, eq(refundRequests.purchaseId, purchases.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(and(...conditions))
    .orderBy(asc(refundRequests.requestedAt), asc(refundRequests.id))
    .all();

  return {
    pending: rows.filter((row) => row.status === RefundRequestStatus.Pending),
    // Most recently Resolved first.
    resolved: rows
      .filter((row) => row.status !== RefundRequestStatus.Pending)
      .sort(
        (a, b) =>
          (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? "") || b.id - a.id
      ),
  };
}
