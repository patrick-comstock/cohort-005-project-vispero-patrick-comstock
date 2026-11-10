import { and, desc, eq, inArray, isNotNull, notExists, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { formatPrice } from "~/lib/utils";
import * as schema from "~/db/schema";
import {
  coupons,
  courses,
  enrollments,
  lessonProgress,
  LessonProgressStatus,
  lessons,
  modules,
  purchases,
  refundRequests,
  RefundRequestStatus,
  UserRole,
  users,
  videoWatchEvents,
} from "~/db/schema";

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

/** A calendar day (YYYY-MM-DD) as it reads in a refusal, e.g. "March 15, 2026". */
export function formatCalendarDay(day: string) {
  return new Date(`${day}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** Why a Purchase outside its Refund Window, before or after it, gets no offer. */
function refundWindowEndedError(purchaseName: string, lastDay: string) {
  return `The ${REFUND_WINDOW_DAYS}-day Refund Window for this ${purchaseName} ended on ${formatCalendarDay(lastDay)}.`;
}

/** The Watch-Time Limit as it reads in a refusal, e.g. "2 hours". */
function describeWatchTimeLimit() {
  const hours = WATCH_TIME_LIMIT_SECONDS / 3600;
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

/** The Completion Limit as it reads in a refusal, e.g. "half". */
function describeCompletionLimit() {
  return COMPLETION_LIMIT === 0.5 ? "half" : `${COMPLETION_LIMIT * 100}%`;
}

/** Whether today falls in a Purchase's Refund Window, counting both ends. */
function isWithinRefundWindow(purchasedAtIso: string, now = new Date()) {
  const today = toCalendarDay(now);
  return (
    today >= toCalendarDay(new Date(purchasedAtIso)) &&
    today <= lastDayOfRefundWindow(purchasedAtIso)
  );
}

/**
 * Whether a Purchase already has a Refund Request, in any status. A Purchase
 * can have at most one Refund Request, ever.
 */
export function hasRefundRequest(database: Db, purchaseId: number) {
  const existing = database
    .select({ id: refundRequests.id })
    .from(refundRequests)
    .where(eq(refundRequests.purchaseId, purchaseId))
    .get();
  return !!existing;
}

/** Whether a Purchase has a Refund Request that is still Pending. */
export function hasPendingRefundRequest(database: Db, purchaseId: number) {
  const pending = database
    .select({ id: refundRequests.id })
    .from(refundRequests)
    .where(
      and(
        eq(refundRequests.purchaseId, purchaseId),
        eq(refundRequests.status, RefundRequestStatus.Pending)
      )
    )
    .get();
  return !!pending;
}

export type Db = BetterSQLite3Database<typeof schema>;

type RefundRequest = typeof refundRequests.$inferSelect;

/** Records a new Pending Refund Request for a Purchase. */
export function makeRefundRequest(
  database: Db,
  input: { purchaseId: number; reason: string }
): { ok: true; refundRequest: RefundRequest } | { ok: false; error: string } {
  // The unique index on purchase_id settles a race between two requests.
  const refundRequest = database
    .insert(refundRequests)
    .values({
      purchaseId: input.purchaseId,
      status: RefundRequestStatus.Pending,
      reason: input.reason,
    })
    .onConflictDoNothing({ target: refundRequests.purchaseId })
    .returning()
    .get();

  if (!refundRequest) {
    return {
      ok: false,
      error: "You have already made a Refund Request for this Purchase.",
    };
  }

  return { ok: true, refundRequest };
}

/** A Team Purchase is a Purchase with Coupons. */
export function isTeamPurchase(database: Db, purchaseId: number) {
  const coupon = database
    .select({ id: coupons.id })
    .from(coupons)
    .where(eq(coupons.purchaseId, purchaseId))
    .get();
  return !!coupon;
}

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

/** Whether a user got a course by Redeeming one of its Coupons. */
function hasRedeemedCouponForCourse(
  database: Db,
  input: { userId: number; courseId: number }
) {
  const redeemed = database
    .select({ id: coupons.id })
    .from(coupons)
    .where(
      and(
        eq(coupons.courseId, input.courseId),
        eq(coupons.redeemedByUserId, input.userId)
      )
    )
    .get();
  return !!redeemed;
}

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
function earlierRefundRequests(
  all: RefundRequestRow[],
  refundRequest: RefundRequestRow
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
 * many earlier Refund Requests from the same person for the same course were
 * Approved, which makes it a Repeat Refund Request when above zero.
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

  const rows = all.map((refundRequest) => ({
    ...refundRequest,
    isTeamPurchase: teamPurchaseIds.has(refundRequest.purchaseId),
    earlierApprovedCount: earlierRefundRequests(all, refundRequest).filter(
      (earlier) => earlier.status === RefundRequestStatus.Approved
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

/**
 * The Purchase a Student's Refund Request offer and Refund Request action
 * target: their most recent Purchase of the course that is not a Team
 * Purchase.
 */
export function getRefundRequestPurchase(
  database: Db,
  userId: number,
  courseId: number
) {
  return database
    .select()
    .from(purchases)
    .where(
      and(
        eq(purchases.userId, userId),
        eq(purchases.courseId, courseId),
        notExists(
          database
            .select({ id: coupons.id })
            .from(coupons)
            .where(eq(coupons.purchaseId, purchases.id))
        )
      )
    )
    .orderBy(desc(purchases.createdAt), desc(purchases.id))
    .get();
}

/**
 * The Purchase that the PPP check in Access looks at. A Purchase that was
 * Refunded (its Refund Request was Approved) no longer counts.
 */
export function findPurchaseForAccess(
  database: Db,
  userId: number,
  courseId: number
) {
  return database
    .select()
    .from(purchases)
    .where(
      and(
        eq(purchases.userId, userId),
        eq(purchases.courseId, courseId),
        notExists(
          database
            .select({ id: refundRequests.id })
            .from(refundRequests)
            .where(
              and(
                eq(refundRequests.purchaseId, purchases.id),
                eq(refundRequests.status, RefundRequestStatus.Approved)
              )
            )
        )
      )
    )
    .orderBy(desc(purchases.createdAt), desc(purchases.id))
    .get();
}

/**
 * How much of a course a user has watched (the furthest point reached in each
 * lesson's video, summed) and the share of its lessons they have completed:
 * what the Watch-Time Limit and Completion Limit are judged on.
 */
function getWatchTimeAndCompletion(
  database: Db,
  userId: number,
  courseId: number
) {
  const lessonIds = database
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .all()
    .map((row) => row.id);

  let watchedSeconds = 0;
  let completedLessons = 0;

  if (lessonIds.length > 0) {
    // The furthest point reached in each lesson's video, summed.
    watchedSeconds = database
      .select({
        furthest: sql<number>`max(${videoWatchEvents.positionSeconds})`,
      })
      .from(videoWatchEvents)
      .where(
        and(
          eq(videoWatchEvents.userId, userId),
          inArray(videoWatchEvents.lessonId, lessonIds)
        )
      )
      .groupBy(videoWatchEvents.lessonId)
      .all()
      .reduce((total, row) => total + row.furthest, 0);

    completedLessons =
      database
        .select({ count: sql<number>`count(*)` })
        .from(lessonProgress)
        .where(
          and(
            eq(lessonProgress.userId, userId),
            eq(lessonProgress.status, LessonProgressStatus.Completed),
            inArray(lessonProgress.lessonId, lessonIds)
          )
        )
        .get()?.count ?? 0;
  }

  return {
    watchedSeconds,
    completion: lessonIds.length > 0 ? completedLessons / lessonIds.length : 0,
  };
}

/**
 * Everything the Admin sees before Resolving one Refund Request. Watch time
 * and completion are context only: Refund Eligibility was judged when the
 * Refund Request was made.
 */
export function getRefundRequestDetail(database: Db, refundRequestId: number) {
  const all = selectRefundRequestRows(database).all();
  const refundRequest = all.find((row) => row.id === refundRequestId);
  if (!refundRequest) return null;

  const { watchedSeconds, completion } = getWatchTimeAndCompletion(
    database,
    refundRequest.userId,
    refundRequest.courseId
  );

  return {
    ...refundRequest,
    isTeamPurchase: isTeamPurchase(database, refundRequest.purchaseId),
    watchedSeconds,
    completion,
    earlierRefundRequests: earlierRefundRequests(all, refundRequest),
  };
}

/**
 * A Student's own Refund Requests, Pending and Resolved, newest first,
 * including those a Team Purchase buyer made for their Team Purchases.
 */
export function listStudentRefundRequests(database: Db, userId: number) {
  return selectRefundRequestRows(database)
    .where(eq(purchases.userId, userId))
    .orderBy(desc(refundRequests.requestedAt), desc(refundRequests.id))
    .all()
    .map((row) => ({
      ...row,
      isTeamPurchase: isTeamPurchase(database, row.purchaseId),
    }));
}

/**
 * The email that tells the Student how their Refund Request was Resolved.
 * There is no mail transport wired up yet, so callers log the message.
 */
export function buildRefundRequestResolvedEmail(input: {
  studentName: string;
  studentEmail: string;
  courseTitle: string;
  status: Resolution;
  isTeamPurchase: boolean;
  refundAmount: number | null;
  resolutionNote: string | null;
}) {
  const isApproved = input.status === RefundRequestStatus.Approved;
  const outcome = isApproved
    ? [
        `Your Refund Request for "${input.courseTitle}" has been approved.`,
        `We are refunding ${formatPrice(input.refundAmount)}, the amount you paid.`,
        input.isTeamPurchase
          ? "Its Coupons have been voided and can no longer be redeemed. Anyone who already redeemed one keeps the course."
          : "Your access to the course has ended.",
      ]
    : [
        `Your Refund Request for "${input.courseTitle}" has been declined, and you keep your access to the course.`,
      ];

  return {
    to: input.studentEmail,
    subject: `Refund Request ${isApproved ? "approved" : "declined"} — ${input.courseTitle}`,
    body: [
      `Hi ${input.studentName},`,
      "",
      ...outcome,
      ...(input.resolutionNote ? ["", input.resolutionNote] : []),
      "",
      "— The Cadence team",
    ].join("\n"),
  };
}

export type RefundRequestOffer =
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
      code: Exclude<RefundRequestRefusalCode, "outside-refund-window">;
      error: string;
    };

export type RefundRequestRefusalCode =
  | "not-enrolled"
  | "joined-with-coupon"
  | "no-purchase"
  | "already-requested"
  | "outside-refund-window"
  | "completion-limit"
  | "watch-time-limit";

function isEnrolled(database: Db, userId: number, courseId: number) {
  const enrollment = database
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .get();
  return !!enrollment;
}

/**
 * The Refund Request a Student may make for a course: their Refund Request
 * Purchase and the Refund amount, or why they may not make one. The course
 * page offers it and the Refund Request action enforces it, so the two
 * cannot drift apart.
 */
export function getRefundRequestOffer(
  database: Db,
  input: { userId: number; courseId: number; now?: Date }
): RefundRequestOffer {
  if (!isEnrolled(database, input.userId, input.courseId)) {
    return {
      ok: false,
      code: "not-enrolled",
      error: "You must be enrolled in this course to make a Refund Request.",
    };
  }

  const purchase = getRefundRequestPurchase(
    database,
    input.userId,
    input.courseId
  );

  if (!purchase && hasRedeemedCouponForCourse(database, input)) {
    return {
      ok: false,
      code: "joined-with-coupon",
      error:
        "You joined this course with a Coupon from a Team Purchase. Only the person who bought it can make a Refund Request.",
    };
  }

  if (!purchase) {
    return {
      ok: false,
      code: "no-purchase",
      error: "You have not bought this course.",
    };
  }

  // A Purchase can have at most one Refund Request, ever (ADR 0002).
  if (hasRefundRequest(database, purchase.id)) {
    return {
      ok: false,
      code: "already-requested",
      error: "You have already made a Refund Request for this Purchase.",
    };
  }

  const lastDayInWindow = lastDayOfRefundWindow(purchase.createdAt);

  if (!isWithinRefundWindow(purchase.createdAt, input.now)) {
    return {
      ok: false,
      code: "outside-refund-window",
      error: refundWindowEndedError("Purchase", lastDayInWindow),
      lastDay: lastDayInWindow,
    };
  }

  const { watchedSeconds, completion } = getWatchTimeAndCompletion(
    database,
    input.userId,
    input.courseId
  );

  if (completion >= COMPLETION_LIMIT) {
    return {
      ok: false,
      code: "completion-limit",
      error: `Refunds aren't available once you've completed ${describeCompletionLimit()} of this course.`,
    };
  }

  if (watchedSeconds >= WATCH_TIME_LIMIT_SECONDS) {
    return {
      ok: false,
      code: "watch-time-limit",
      error: `Refunds aren't available once you've watched ${describeWatchTimeLimit()} or more of this course.`,
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
 * What the course page tells an enrolled Student who gets no Refund Request
 * offer, or null to show nothing: an existing Refund Request shows its status
 * instead, and without an Enrollment or a Purchase there is nothing to refund.
 */
export function refusalReasonForStudent(
  refusal: Extract<RefundRequestOffer, { ok: false }>
): string | null {
  switch (refusal.code) {
    case "outside-refund-window":
    case "completion-limit":
    case "watch-time-limit":
    case "joined-with-coupon":
      return refusal.error;
    case "already-requested":
    case "not-enrolled":
    case "no-purchase":
      return null;
  }
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

  if (!isWithinRefundWindow(purchase.createdAt, input.now)) {
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
      error: "Refunds aren't available once a Coupon has been redeemed.",
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
