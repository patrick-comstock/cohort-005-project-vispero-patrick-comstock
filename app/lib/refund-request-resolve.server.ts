import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "~/db";
import {
  coupons,
  courses,
  enrollments,
  purchases,
  refundRequests,
  RefundRequestStatus,
  UserRole,
  users,
} from "~/db/schema";
import {
  getWatchTimeAndCompletion,
  isTeamPurchase,
} from "~/lib/refund-eligibility.server";

type RefundRequest = typeof refundRequests.$inferSelect;

export type Resolution =
  RefundRequestStatus.Approved | RefundRequestStatus.Declined;

export type ResolveErrorCode =
  "not-found" | "not-admin" | "already-resolved" | "note-required";

export type ResolveResult =
  | { ok: true; refundRequest: RefundRequest }
  | { ok: false; code: ResolveErrorCode; error: string };

/** An Admin Resolves a Pending Refund Request to Approved or Declined. */
export function resolveRefundRequest(
  database: Db,
  input: {
    refundRequestId: number;
    adminUserId: number;
    resolution: Resolution;
    resolutionNote?: string | null;
  }
): ResolveResult {
  const existing = database
    .select({
      amountPaid: purchases.amountPaid,
      userId: purchases.userId,
      courseId: purchases.courseId,
    })
    .from(refundRequests)
    .innerJoin(purchases, eq(refundRequests.purchaseId, purchases.id))
    .where(eq(refundRequests.id, input.refundRequestId))
    .get();

  if (!existing) {
    return { ok: false, code: "not-found", error: "Refund Request not found." };
  }

  const resolver = database
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, input.adminUserId))
    .get();

  if (resolver?.role !== UserRole.Admin) {
    return {
      ok: false,
      code: "not-admin",
      error: "Only an Admin can Resolve a Refund Request.",
    };
  }

  const isApproved = input.resolution === RefundRequestStatus.Approved;
  const resolutionNote = input.resolutionNote?.trim() || null;

  if (!isApproved && !resolutionNote) {
    return {
      ok: false,
      code: "note-required",
      error: "A Resolution Note is required to Decline a Refund Request.",
    };
  }

  return database.transaction((tx): ResolveResult => {
    // Only a Pending Refund Request is updated, so when two Resolves race the
    // first one wins and the second finds nothing to update.
    const refundRequest = tx
      .update(refundRequests)
      .set({
        status: input.resolution,
        refundAmount: isApproved ? existing.amountPaid : null,
        resolutionNote,
        resolvedAt: new Date().toISOString(),
        resolvedByUserId: input.adminUserId,
      })
      .where(
        and(
          eq(refundRequests.id, input.refundRequestId),
          eq(refundRequests.status, RefundRequestStatus.Pending)
        )
      )
      .returning()
      .get();

    if (!refundRequest) {
      return {
        ok: false,
        code: "already-resolved",
        error: "This Refund Request has already been Resolved.",
      };
    }

    if (isApproved && isTeamPurchase(tx, refundRequest.purchaseId)) {
      // A Team Purchase gave its buyer no Enrollment, so Approval only Voids
      // its Coupons. Any Enrollment the buyer has came from another Purchase.
      tx.update(coupons)
        .set({ voidedAt: refundRequest.resolvedAt })
        .where(eq(coupons.purchaseId, refundRequest.purchaseId))
        .run();
    } else if (isApproved) {
      // The Refund ends Access by removing the Enrollment (ADR 0001). Lesson
      // progress is keyed on the user and lesson, not the Enrollment, so it is
      // kept and comes back if the Student buys again.
      tx.delete(enrollments)
        .where(
          and(
            eq(enrollments.userId, existing.userId),
            eq(enrollments.courseId, existing.courseId)
          )
        )
        .run();
    }

    return { ok: true, refundRequest };
  });
}

function selectRefundRequestRows(database: Db) {
  return database
    .select({
      id: refundRequests.id,
      status: refundRequests.status,
      reason: refundRequests.reason,
      refundAmount: refundRequests.refundAmount,
      resolutionNote: refundRequests.resolutionNote,
      requestedAt: refundRequests.requestedAt,
      resolvedAt: refundRequests.resolvedAt,
      purchaseId: purchases.id,
      amountPaid: purchases.amountPaid,
      purchasedAt: purchases.createdAt,
      userId: users.id,
      userName: users.name,
      userEmail: users.email,
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(refundRequests)
    .innerJoin(purchases, eq(refundRequests.purchaseId, purchases.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id));
}

type RefundRequestRow = Awaited<
  ReturnType<ReturnType<typeof selectRefundRequestRows>["all"]>
>[number];

function isEarlier(a: RefundRequestRow, b: RefundRequestRow) {
  return (
    a.requestedAt < b.requestedAt ||
    (a.requestedAt === b.requestedAt && a.id < b.id)
  );
}

/**
 * The same person's earlier Refund Requests for the same course, oldest
 * first. Information for the Admin; it never blocks Resolving.
 */
function earlierRefundRequests<Row extends RefundRequestRow>(
  all: Row[],
  refundRequest: Row
) {
  return all
    .filter(
      (other) =>
        other.userId === refundRequest.userId &&
        other.courseId === refundRequest.courseId &&
        isEarlier(other, refundRequest)
    )
    .sort((a, b) => (isEarlier(a, b) ? -1 : 1));
}

/**
 * Every Refund Request for the Admin: Pending ones oldest first, and Resolved
 * ones as a separate history, most recently Resolved first. Each carries how
 * many earlier Refund Requests of the same kind from the same Requester for
 * the same course are now Approved, which makes it a Repeat Refund Request
 * when above zero.
 */
export function listRefundRequests(database: Db) {
  const all = selectRefundRequestRows(database).all();
  const teamPurchaseIds = new Set(
    database
      .selectDistinct({ purchaseId: coupons.purchaseId })
      .from(coupons)
      .all()
      .map((row) => row.purchaseId)
  );

  const withKind = all.map((refundRequest) => ({
    ...refundRequest,
    isTeamPurchase: teamPurchaseIds.has(refundRequest.purchaseId),
  }));

  const rows = withKind.map((refundRequest) => ({
    ...refundRequest,
    earlierApprovedCount: earlierRefundRequests(withKind, refundRequest).filter(
      (earlier) =>
        earlier.isTeamPurchase === refundRequest.isTeamPurchase &&
        earlier.status === RefundRequestStatus.Approved
    ).length,
  }));

  const pending = rows
    .filter((row) => row.status === RefundRequestStatus.Pending)
    .sort((a, b) => (isEarlier(a, b) ? -1 : 1));

  const resolved = rows
    .filter((row) => row.status !== RefundRequestStatus.Pending)
    .sort((a, b) =>
      (a.resolvedAt ?? "") === (b.resolvedAt ?? "")
        ? b.id - a.id
        : (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? "")
    );

  return { pending, resolved };
}

/** How many Coupons a Team Purchase has, and how many of them were Redeemed. */
function getCouponCounts(database: Db, purchaseId: number) {
  const row = database
    .select({
      coupons: sql<number>`count(*)`,
      redeemed: sql<number>`count(${coupons.redeemedByUserId})`,
    })
    .from(coupons)
    .where(eq(coupons.purchaseId, purchaseId))
    .get();
  return { coupons: row?.coupons ?? 0, redeemed: row?.redeemed ?? 0 };
}

/**
 * Everything the Admin sees before Resolving one Refund Request. Watch time
 * and completion are context only: Refund Eligibility was judged when the
 * Refund Request was made. They are null for a Team Purchase, whose Refund
 * Eligibility has no Watch-Time Limit or Completion Limit and whose buyer's
 * own viewing is unrelated to it. For a Team Purchase the Admin sees instead
 * how many Coupons it has and how many were Redeemed; these are null for an
 * individual Purchase.
 */
export function getRefundRequestDetail(database: Db, refundRequestId: number) {
  const all = selectRefundRequestRows(database).all();
  const refundRequest = all.find((row) => row.id === refundRequestId);
  if (!refundRequest) return null;

  const teamPurchase = isTeamPurchase(database, refundRequest.purchaseId);

  return {
    ...refundRequest,
    isTeamPurchase: teamPurchase,
    watchTimeAndCompletion: teamPurchase
      ? null
      : getWatchTimeAndCompletion(
          database,
          refundRequest.userId,
          refundRequest.courseId
        ),
    couponCounts: teamPurchase
      ? getCouponCounts(database, refundRequest.purchaseId)
      : null,
    earlierRefundRequests: earlierRefundRequests(all, refundRequest),
  };
}

/**
 * A Requester's own Refund Requests, Pending and Resolved, newest first: those
 * they made as a Student and those they made for their Team Purchases.
 */
export function listRequesterRefundRequests(database: Db, userId: number) {
  return selectRefundRequestRows(database)
    .where(eq(purchases.userId, userId))
    .orderBy(desc(refundRequests.requestedAt), desc(refundRequests.id))
    .all()
    .map((row) => ({
      ...row,
      isTeamPurchase: isTeamPurchase(database, row.purchaseId),
    }));
}
