import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { RefundRequestStatus, UserRole } from "~/db/schema";
import {
  buildRefundRequestResolvedEmail,
  findPurchaseForAccess,
  getRefundRequestDetail,
  getRefundRequestOffer,
  getTeamPurchaseRefundRequestOffer,
  formatCalendarDay,
  refusalReasonForStudent,
  refusalReasonForTeamPurchaseBuyer,
  getRefundRequestPurchase,
  hasRefundRequest,
  listRefundRequests,
  listStudentRefundRequests,
  listTeamPurchasesForBuyer,
  makeRefundRequest,
  makeTeamPurchaseRefundRequest,
  resolveRefundRequest,
} from "./refund-requests.server";

type TestDb = ReturnType<typeof createTestDb>;

let testDb: TestDb;
let base: ReturnType<typeof seedBaseData>;
let admin: typeof schema.users.$inferSelect;

beforeEach(() => {
  testDb = createTestDb();
  base = seedBaseData(testDb);
  admin = testDb
    .insert(schema.users)
    .values({
      name: "Ada Admin",
      email: "admin@example.com",
      role: UserRole.Admin,
    })
    .returning()
    .get();
});

function buyCourse(userId: number, amountPaid = 4999) {
  const purchase = testDb
    .insert(schema.purchases)
    .values({ userId, courseId: base.course.id, amountPaid, country: "US" })
    .returning()
    .get();
  testDb
    .insert(schema.enrollments)
    .values({ userId, courseId: base.course.id })
    .run();
  return purchase;
}

function requestRefund(purchaseId: number) {
  const result = makeRefundRequest(testDb, {
    purchaseId,
    reason: "The course was not what I expected.",
  });
  if (!result.ok) throw new Error(result.error);
  return result.refundRequest;
}

describe("resolveRefundRequest", () => {
  it("records the Refund at the amount paid when an Admin Approves", () => {
    const purchase = buyCourse(base.user.id, 2500);
    const refundRequest = requestRefund(purchase.id);

    const result = resolveRefundRequest(testDb, {
      refundRequestId: refundRequest.id,
      adminUserId: admin.id,
      resolution: RefundRequestStatus.Approved,
    });

    expect(result).toMatchObject({
      ok: true,
      refundRequest: {
        status: RefundRequestStatus.Approved,
        refundAmount: 2500,
        resolvedByUserId: admin.id,
      },
    });
  });
});

describe("resolveRefundRequest — who may Resolve", () => {
  it("rejects a Resolve by someone who is not an Admin and leaves it Pending", () => {
    const purchase = buyCourse(base.user.id);
    const refundRequest = requestRefund(purchase.id);

    const result = resolveRefundRequest(testDb, {
      refundRequestId: refundRequest.id,
      adminUserId: base.instructor.id,
      resolution: RefundRequestStatus.Approved,
    });

    expect(result).toMatchObject({ ok: false, code: "not-admin" });
    expect(listRefundRequests(testDb).pending.map((r) => r.id)).toEqual([
      refundRequest.id,
    ]);
  });
});

describe("resolveRefundRequest — a Resolution is final", () => {
  it("rejects a second Resolve and keeps the first Resolution", () => {
    const purchase = buyCourse(base.user.id);
    const refundRequest = requestRefund(purchase.id);

    resolveRefundRequest(testDb, {
      refundRequestId: refundRequest.id,
      adminUserId: admin.id,
      resolution: RefundRequestStatus.Declined,
      resolutionNote: "You have finished most of the course.",
    });

    const second = resolveRefundRequest(testDb, {
      refundRequestId: refundRequest.id,
      adminUserId: admin.id,
      resolution: RefundRequestStatus.Approved,
    });

    expect(second).toMatchObject({ ok: false, code: "already-resolved" });
    expect(listRefundRequests(testDb).resolved).toMatchObject([
      { id: refundRequest.id, status: RefundRequestStatus.Declined },
    ]);
  });
});

describe("resolveRefundRequest — Resolution Note", () => {
  it("requires a Resolution Note to Decline", () => {
    const purchase = buyCourse(base.user.id);
    const refundRequest = requestRefund(purchase.id);

    const result = resolveRefundRequest(testDb, {
      refundRequestId: refundRequest.id,
      adminUserId: admin.id,
      resolution: RefundRequestStatus.Declined,
      resolutionNote: "   ",
    });

    expect(result).toMatchObject({ ok: false, code: "note-required" });
    expect(listRefundRequests(testDb).pending.map((r) => r.id)).toEqual([
      refundRequest.id,
    ]);
  });

  it("Declines with a Resolution Note and records no Refund", () => {
    const purchase = buyCourse(base.user.id);
    const refundRequest = requestRefund(purchase.id);

    const result = resolveRefundRequest(testDb, {
      refundRequestId: refundRequest.id,
      adminUserId: admin.id,
      resolution: RefundRequestStatus.Declined,
      resolutionNote: "You have finished most of the course.",
    });

    expect(result).toMatchObject({
      ok: true,
      refundRequest: {
        status: RefundRequestStatus.Declined,
        refundAmount: null,
        resolutionNote: "You have finished most of the course.",
      },
    });
  });
});

describe("resolveRefundRequest — what Approval does", () => {
  function addCompletedLesson(userId: number) {
    const module = testDb
      .insert(schema.modules)
      .values({ courseId: base.course.id, title: "Basics", position: 1 })
      .returning()
      .get();
    const lesson = testDb
      .insert(schema.lessons)
      .values({ moduleId: module.id, title: "Hello", position: 1 })
      .returning()
      .get();
    testDb
      .insert(schema.lessonProgress)
      .values({
        userId,
        lessonId: lesson.id,
        status: schema.LessonProgressStatus.Completed,
      })
      .run();
  }

  function enrollmentsFor(userId: number) {
    return testDb
      .select()
      .from(schema.enrollments)
      .where(eq(schema.enrollments.userId, userId))
      .all();
  }

  function lessonProgressFor(userId: number) {
    return testDb
      .select()
      .from(schema.lessonProgress)
      .where(eq(schema.lessonProgress.userId, userId))
      .all();
  }

  it("removes the Student's Enrollment and keeps their lesson progress", () => {
    const purchase = buyCourse(base.user.id);
    addCompletedLesson(base.user.id);
    const refundRequest = requestRefund(purchase.id);

    resolveRefundRequest(testDb, {
      refundRequestId: refundRequest.id,
      adminUserId: admin.id,
      resolution: RefundRequestStatus.Approved,
    });

    expect(enrollmentsFor(base.user.id)).toEqual([]);
    expect(lessonProgressFor(base.user.id)).toHaveLength(1);
  });

  it("keeps the Student's Enrollment when Declined", () => {
    const purchase = buyCourse(base.user.id);
    const refundRequest = requestRefund(purchase.id);

    resolveRefundRequest(testDb, {
      refundRequestId: refundRequest.id,
      adminUserId: admin.id,
      resolution: RefundRequestStatus.Declined,
      resolutionNote: "Outside our policy.",
    });

    expect(enrollmentsFor(base.user.id)).toHaveLength(1);
  });
});

describe("resolveRefundRequest — Team Purchase", () => {
  function buyForTeam(userId: number, couponCount: number) {
    const team = testDb.insert(schema.teams).values({}).returning().get();
    const purchase = testDb
      .insert(schema.purchases)
      .values({
        userId,
        courseId: base.course.id,
        amountPaid: 4999 * couponCount,
        country: "US",
      })
      .returning()
      .get();
    testDb
      .insert(schema.coupons)
      .values(
        Array.from({ length: couponCount }, (_, i) => ({
          teamId: team.id,
          courseId: base.course.id,
          code: `TEAM-${purchase.id}-${i}`,
          purchaseId: purchase.id,
        }))
      )
      .run();
    return purchase;
  }

  function couponsFor(purchaseId: number) {
    return testDb
      .select()
      .from(schema.coupons)
      .where(eq(schema.coupons.purchaseId, purchaseId))
      .all();
  }

  it("Voids every Coupon of the Team Purchase and refunds the full amount paid", () => {
    const purchase = buyForTeam(base.user.id, 3);
    const refundRequest = requestRefund(purchase.id);

    const result = resolveRefundRequest(testDb, {
      refundRequestId: refundRequest.id,
      adminUserId: admin.id,
      resolution: RefundRequestStatus.Approved,
    });

    expect(result).toMatchObject({
      ok: true,
      refundRequest: { refundAmount: 3 * 4999 },
    });
    const coupons = couponsFor(purchase.id);
    expect(coupons).toHaveLength(3);
    expect(coupons.every((coupon) => coupon.voidedAt !== null)).toBe(true);
  });

  it("keeps the buyer's Enrollment from their own separate Purchase", () => {
    buyCourse(base.user.id);
    const teamPurchase = buyForTeam(base.user.id, 2);
    const refundRequest = requestRefund(teamPurchase.id);

    resolveRefundRequest(testDb, {
      refundRequestId: refundRequest.id,
      adminUserId: admin.id,
      resolution: RefundRequestStatus.Approved,
    });

    const enrollments = testDb
      .select()
      .from(schema.enrollments)
      .where(eq(schema.enrollments.userId, base.user.id))
      .all();
    expect(enrollments).toHaveLength(1);
  });

  it("leaves the Coupons Redeemable when Declined", () => {
    const purchase = buyForTeam(base.user.id, 2);
    const refundRequest = requestRefund(purchase.id);

    resolveRefundRequest(testDb, {
      refundRequestId: refundRequest.id,
      adminUserId: admin.id,
      resolution: RefundRequestStatus.Declined,
      resolutionNote: "Your team is still using it.",
    });

    expect(couponsFor(purchase.id).every((c) => c.voidedAt === null)).toBe(
      true
    );
  });
});

describe("makeRefundRequest", () => {
  it("rejects a new Refund Request for a Purchase whose Refund Request was Resolved", () => {
    const purchase = buyCourse(base.user.id);
    const refundRequest = requestRefund(purchase.id);
    resolveRefundRequest(testDb, {
      refundRequestId: refundRequest.id,
      adminUserId: admin.id,
      resolution: RefundRequestStatus.Declined,
      resolutionNote: "Outside our policy.",
    });

    const second = makeRefundRequest(testDb, {
      purchaseId: purchase.id,
      reason: "Please reconsider my request.",
    });

    expect(second).toMatchObject({ ok: false });
    expect(hasRefundRequest(testDb, purchase.id)).toBe(true);
  });

  it("rejects a second Refund Request while the first is Pending", () => {
    const purchase = buyCourse(base.user.id);
    requestRefund(purchase.id);

    const second = makeRefundRequest(testDb, {
      purchaseId: purchase.id,
      reason: "Just checking in on this one.",
    });

    expect(second).toMatchObject({ ok: false });
  });

  it("allows a Refund Request for a new Purchase after a Refund", () => {
    const first = buyCourse(base.user.id);
    resolveRefundRequest(testDb, {
      refundRequestId: requestRefund(first.id).id,
      adminUserId: admin.id,
      resolution: RefundRequestStatus.Approved,
    });

    const again = buyCourse(base.user.id);

    expect(hasRefundRequest(testDb, again.id)).toBe(false);
    expect(
      makeRefundRequest(testDb, {
        purchaseId: again.id,
        reason: "Still not for me, sorry.",
      })
    ).toMatchObject({ ok: true });
  });
});

describe("getRefundRequestPurchase", () => {
  it("targets the Student's most recent Purchase that is not a Team Purchase", () => {
    const own = buyCourse(base.user.id);
    const team = testDb.insert(schema.teams).values({}).returning().get();
    const later = new Date(Date.now() + 60_000).toISOString();
    const teamPurchase = testDb
      .insert(schema.purchases)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        amountPaid: 9998,
        createdAt: later,
      })
      .returning()
      .get();
    testDb
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code: "TEAM-LATER",
        purchaseId: teamPurchase.id,
      })
      .run();

    expect(
      getRefundRequestPurchase(testDb, base.user.id, base.course.id)?.id
    ).toBe(own.id);
  });
});

describe("findPurchaseForAccess", () => {
  it("ignores a Purchase whose Refund Request was Approved", () => {
    const refunded = buyCourse(base.user.id);
    resolveRefundRequest(testDb, {
      refundRequestId: requestRefund(refunded.id).id,
      adminUserId: admin.id,
      resolution: RefundRequestStatus.Approved,
    });

    expect(
      findPurchaseForAccess(testDb, base.user.id, base.course.id)
    ).toBeUndefined();

    const again = buyCourse(base.user.id);

    expect(
      findPurchaseForAccess(testDb, base.user.id, base.course.id)?.id
    ).toBe(again.id);
  });
});

describe("listRefundRequests", () => {
  function refundAndBuyAgain(resolution: "approve" | "decline") {
    const purchase = buyCourse(base.user.id);
    resolveRefundRequest(testDb, {
      refundRequestId: requestRefund(purchase.id).id,
      adminUserId: admin.id,
      ...(resolution === "approve"
        ? { resolution: RefundRequestStatus.Approved }
        : {
            resolution: RefundRequestStatus.Declined,
            resolutionNote: "Outside our policy.",
          }),
    });
    if (resolution === "decline") {
      // A Declined Student keeps their Enrollment; drop it so they can buy again.
      testDb.delete(schema.enrollments).run();
    }
  }

  it("lists Pending Refund Requests oldest first", () => {
    const other = testDb
      .insert(schema.users)
      .values({
        name: "Other",
        email: "other@example.com",
        role: UserRole.Student,
      })
      .returning()
      .get();
    const first = requestRefund(buyCourse(base.user.id).id);
    const second = requestRefund(buyCourse(other.id).id);

    expect(listRefundRequests(testDb).pending.map((r) => r.id)).toEqual([
      first.id,
      second.id,
    ]);
  });

  it("counts earlier Approved Refund Requests for the same course as a Repeat Refund Request", () => {
    refundAndBuyAgain("approve");
    refundAndBuyAgain("decline");
    refundAndBuyAgain("approve");
    const latest = requestRefund(buyCourse(base.user.id).id);

    const { pending } = listRefundRequests(testDb);

    expect(pending).toMatchObject([{ id: latest.id, earlierApprovedCount: 2 }]);
  });

  it("does not count a Student's first Refund Request as a Repeat Refund Request", () => {
    requestRefund(buyCourse(base.user.id).id);

    expect(listRefundRequests(testDb).pending).toMatchObject([
      { earlierApprovedCount: 0 },
    ]);
  });
});

describe("getRefundRequestDetail", () => {
  it("lists the person's earlier Refund Requests for the course, Declined ones included", () => {
    const first = buyCourse(base.user.id);
    resolveRefundRequest(testDb, {
      refundRequestId: requestRefund(first.id).id,
      adminUserId: admin.id,
      resolution: RefundRequestStatus.Declined,
      resolutionNote: "Outside our policy.",
    });
    testDb.delete(schema.enrollments).run();
    const latest = requestRefund(buyCourse(base.user.id).id);

    const detail = getRefundRequestDetail(testDb, latest.id);

    expect(detail?.earlierRefundRequests).toMatchObject([
      {
        status: RefundRequestStatus.Declined,
        resolutionNote: "Outside our policy.",
      },
    ]);
  });

  it("shows watch time and completion as context", () => {
    const module = testDb
      .insert(schema.modules)
      .values({ courseId: base.course.id, title: "Basics", position: 1 })
      .returning()
      .get();
    const [lessonA, lessonB] = testDb
      .insert(schema.lessons)
      .values([
        { moduleId: module.id, title: "A", position: 1 },
        { moduleId: module.id, title: "B", position: 2 },
      ])
      .returning()
      .all();
    testDb
      .insert(schema.lessonProgress)
      .values({
        userId: base.user.id,
        lessonId: lessonA.id,
        status: schema.LessonProgressStatus.Completed,
      })
      .run();
    testDb
      .insert(schema.videoWatchEvents)
      .values([
        {
          userId: base.user.id,
          lessonId: lessonA.id,
          eventType: "progress",
          positionSeconds: 100,
        },
        {
          userId: base.user.id,
          lessonId: lessonA.id,
          eventType: "progress",
          positionSeconds: 300,
        },
        {
          userId: base.user.id,
          lessonId: lessonB.id,
          eventType: "progress",
          positionSeconds: 60,
        },
      ])
      .run();
    const refundRequest = requestRefund(buyCourse(base.user.id).id);

    const detail = getRefundRequestDetail(testDb, refundRequest.id);

    expect(detail).toMatchObject({ watchedSeconds: 360, completion: 0.5 });
  });
});

describe("listStudentRefundRequests", () => {
  it("shows the Student their Pending and Resolved Refund Requests, newest first", () => {
    const first = buyCourse(base.user.id, 2500);
    resolveRefundRequest(testDb, {
      refundRequestId: requestRefund(first.id).id,
      adminUserId: admin.id,
      resolution: RefundRequestStatus.Approved,
      resolutionNote: "Sorry it was not a fit.",
    });
    const pending = requestRefund(buyCourse(base.user.id).id);

    expect(listStudentRefundRequests(testDb, base.user.id)).toMatchObject([
      { id: pending.id, status: RefundRequestStatus.Pending },
      {
        status: RefundRequestStatus.Approved,
        refundAmount: 2500,
        resolutionNote: "Sorry it was not a fit.",
      },
    ]);
  });
});

describe("buildRefundRequestResolvedEmail", () => {
  const student = {
    studentName: "Sam",
    studentEmail: "sam@example.com",
    courseTitle: "Test Course",
  };

  it("tells a Team Purchase buyer their Coupons were Voided, not that they lost Access", () => {
    const email = buildRefundRequestResolvedEmail({
      ...student,
      status: RefundRequestStatus.Approved,
      isTeamPurchase: true,
      refundAmount: 9998,
      resolutionNote: null,
    });

    expect(email.body).toContain("$99.98");
    expect(email.body).toContain("Coupons");
    expect(email.body).not.toContain("access");
  });

  it("tells a Team Purchase buyer their Coupons can be Redeemed again when Declined, not that they keep Access", () => {
    const email = buildRefundRequestResolvedEmail({
      ...student,
      status: RefundRequestStatus.Declined,
      isTeamPurchase: true,
      refundAmount: null,
      resolutionNote: "Outside our policy.",
    });

    expect(email.subject).toContain("declined");
    expect(email.body).toContain("Coupons");
    expect(email.body).toContain("Redeemed again");
    expect(email.body).not.toContain("access");
  });

  it("tells a Student they keep their access to the course when Declined", () => {
    const email = buildRefundRequestResolvedEmail({
      ...student,
      status: RefundRequestStatus.Declined,
      isTeamPurchase: false,
      refundAmount: null,
      resolutionNote: "Outside our policy.",
    });

    expect(email.body).toContain(
      'Your Refund Request for "Test Course" has been declined, and you keep your access to the course.'
    );
    expect(email.body).not.toContain("Coupon");
  });

  it("includes the Resolution Note when Declined", () => {
    const email = buildRefundRequestResolvedEmail({
      ...student,
      status: RefundRequestStatus.Declined,
      isTeamPurchase: false,
      refundAmount: null,
      resolutionNote: "Outside our policy.",
    });

    expect(email.subject).toContain("declined");
    expect(email.body).toContain("Outside our policy.");
  });
});

describe("getRefundRequestOffer", () => {
  function offerOn(day: string) {
    return getRefundRequestOffer(testDb, {
      userId: base.user.id,
      courseId: base.course.id,
      now: new Date(`${day}T12:00:00`),
    });
  }

  function buyCourseOn(day: string, amountPaid = 4999) {
    const purchase = buyCourse(base.user.id, amountPaid);
    testDb
      .update(schema.purchases)
      .set({ createdAt: new Date(`${day}T09:00:00`).toISOString() })
      .where(eq(schema.purchases.id, purchase.id))
      .run();
    return purchase;
  }

  it("offers an enrolled Student a Refund Request for the amount paid within the Refund Window", () => {
    buyCourseOn("2026-03-01", 2500);

    expect(offerOn("2026-03-15")).toMatchObject({
      ok: true,
      amount: 2500,
      lastDayInWindow: "2026-03-15",
    });
  });

  it("makes no offer to someone without an Enrollment in the course", () => {
    const purchase = buyCourseOn("2026-03-01");
    testDb
      .delete(schema.enrollments)
      .where(eq(schema.enrollments.userId, purchase.userId))
      .run();

    expect(offerOn("2026-03-02")).toMatchObject({
      ok: false,
      code: "not-enrolled",
    });
  });

  it("makes no offer to an enrolled Student with no Purchase of their own", () => {
    testDb
      .insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();

    expect(offerOn("2026-03-02")).toMatchObject({
      ok: false,
      code: "no-purchase",
    });
  });

  it("makes no offer to a Student who joined by Redeeming a Coupon, and says why", () => {
    const team = testDb.insert(schema.teams).values({}).returning().get();
    const teamPurchase = testDb
      .insert(schema.purchases)
      .values({
        userId: admin.id,
        courseId: base.course.id,
        amountPaid: 9998,
        country: "US",
      })
      .returning()
      .get();
    testDb
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code: "TEAM-JOINED",
        purchaseId: teamPurchase.id,
        redeemedByUserId: base.user.id,
        redeemedAt: new Date().toISOString(),
      })
      .run();
    testDb
      .insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();

    expect(offerOn("2026-03-02")).toMatchObject({
      ok: false,
      code: "joined-with-coupon",
      error:
        "You joined this course with a Coupon from a Team Purchase. Only the person who bought it can make a Refund Request.",
    });
  });

  it("makes no offer for a Purchase that already has a Refund Request", () => {
    requestRefund(buyCourseOn("2026-03-01").id);

    expect(offerOn("2026-03-02")).toMatchObject({
      ok: false,
      code: "already-requested",
    });
  });

  it("makes no offer after the last day of the Refund Window, and says when it ended", () => {
    buyCourseOn("2026-03-01");

    expect(offerOn("2026-03-16")).toMatchObject({
      ok: false,
      code: "outside-refund-window",
      lastDay: "2026-03-15",
      error:
        "The 14-day Refund Window for this Purchase ended on March 15, 2026.",
    });
  });

  it("makes no offer before the day of the Purchase, with the same reason", () => {
    buyCourseOn("2026-03-01");

    expect(offerOn("2026-02-28")).toMatchObject({
      ok: false,
      code: "outside-refund-window",
      lastDay: "2026-03-15",
      error:
        "The 14-day Refund Window for this Purchase ended on March 15, 2026.",
    });
  });

  function addLessons(count: number) {
    const module = testDb
      .insert(schema.modules)
      .values({ courseId: base.course.id, title: "Basics", position: 1 })
      .returning()
      .get();
    return testDb
      .insert(schema.lessons)
      .values(
        Array.from({ length: count }, (_, i) => ({
          moduleId: module.id,
          title: `Lesson ${i + 1}`,
          position: i + 1,
        }))
      )
      .returning()
      .all();
  }

  function complete(lessons: { id: number }[]) {
    testDb
      .insert(schema.lessonProgress)
      .values(
        lessons.map((lesson) => ({
          userId: base.user.id,
          lessonId: lesson.id,
          status: schema.LessonProgressStatus.Completed,
        }))
      )
      .run();
  }

  it("makes no offer once the Student has completed half the lessons", () => {
    const lessons = addLessons(4);
    complete(lessons.slice(0, 2));
    buyCourseOn("2026-03-01");

    expect(offerOn("2026-03-02")).toMatchObject({
      ok: false,
      code: "completion-limit",
      error:
        "Refunds aren't available once you've completed half of this course.",
    });
  });

  it("still offers while the Student has completed under half the lessons", () => {
    const lessons = addLessons(4);
    complete(lessons.slice(0, 1));
    buyCourseOn("2026-03-01");

    expect(offerOn("2026-03-02")).toMatchObject({ ok: true });
  });

  it("makes no offer once the Student has watched 2 hours of the course", () => {
    const [lessonA, lessonB] = addLessons(2);
    testDb
      .insert(schema.videoWatchEvents)
      .values([
        {
          userId: base.user.id,
          lessonId: lessonA.id,
          eventType: "progress",
          positionSeconds: 3600,
        },
        {
          userId: base.user.id,
          lessonId: lessonB.id,
          eventType: "progress",
          positionSeconds: 3600,
        },
      ])
      .run();
    buyCourseOn("2026-03-01");

    expect(offerOn("2026-03-02")).toMatchObject({
      ok: false,
      code: "watch-time-limit",
      error:
        "Refunds aren't available once you've watched 2 hours or more of this course.",
    });
  });
});

describe("getTeamPurchaseRefundRequestOffer", () => {
  function buyForTeamOn(day: string, couponCount = 3, amountPaid = 15000) {
    const team = testDb.insert(schema.teams).values({}).returning().get();
    const purchase = testDb
      .insert(schema.purchases)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        amountPaid,
        country: "US",
        createdAt: new Date(`${day}T09:00:00`).toISOString(),
      })
      .returning()
      .get();
    testDb
      .insert(schema.coupons)
      .values(
        Array.from({ length: couponCount }, (_, i) => ({
          teamId: team.id,
          courseId: base.course.id,
          code: `TEAM-${purchase.id}-${i}`,
          purchaseId: purchase.id,
        }))
      )
      .run();
    return purchase;
  }

  function offerOn(purchaseId: number, day: string, userId = base.user.id) {
    return getTeamPurchaseRefundRequestOffer(testDb, {
      userId,
      purchaseId,
      now: new Date(`${day}T12:00:00`),
    });
  }

  it("offers the buyer a Refund Request for the amount paid within the Refund Window", () => {
    const purchase = buyForTeamOn("2026-03-01", 3, 15000);

    expect(offerOn(purchase.id, "2026-03-15")).toMatchObject({
      ok: true,
      amount: 15000,
      lastDayInWindow: "2026-03-15",
    });
  });

  it("makes no offer to anyone but the buyer", () => {
    const purchase = buyForTeamOn("2026-03-01");

    expect(offerOn(purchase.id, "2026-03-02", admin.id)).toMatchObject({
      ok: false,
      code: "not-buyer",
    });
  });

  it("makes no offer for a Purchase that is not a Team Purchase", () => {
    const purchase = buyCourse(base.user.id);

    expect(offerOn(purchase.id, "2026-03-02")).toMatchObject({
      ok: false,
      code: "not-team-purchase",
    });
  });

  it("makes no offer for a Team Purchase that already has a Refund Request", () => {
    const purchase = buyForTeamOn("2026-03-01");
    requestRefund(purchase.id);

    expect(offerOn(purchase.id, "2026-03-02")).toMatchObject({
      ok: false,
      code: "already-requested",
    });
  });

  it("makes no offer outside the Refund Window, at either end, and says when it ended", () => {
    const purchase = buyForTeamOn("2026-03-01");
    const refusal = {
      ok: false,
      code: "outside-refund-window",
      lastDay: "2026-03-15",
      error:
        "The 14-day Refund Window for this Team Purchase ended on March 15, 2026.",
    };

    expect(offerOn(purchase.id, "2026-02-28")).toMatchObject(refusal);
    expect(offerOn(purchase.id, "2026-03-16")).toMatchObject(refusal);
  });

  it("makes no offer once any of its Coupons is Redeemed", () => {
    const purchase = buyForTeamOn("2026-03-01");
    const [coupon] = testDb
      .select()
      .from(schema.coupons)
      .where(eq(schema.coupons.purchaseId, purchase.id))
      .all();
    testDb
      .update(schema.coupons)
      .set({ redeemedByUserId: admin.id, redeemedAt: new Date().toISOString() })
      .where(eq(schema.coupons.id, coupon.id))
      .run();

    expect(offerOn(purchase.id, "2026-03-02")).toMatchObject({
      ok: false,
      code: "coupon-redeemed",
      error: "Refunds aren't available once a Coupon has been redeemed.",
    });
  });

  it("has no Watch-Time or Completion Limit, since the buyer has no Enrollment", () => {
    const module = testDb
      .insert(schema.modules)
      .values({ courseId: base.course.id, title: "Basics", position: 1 })
      .returning()
      .get();
    const lesson = testDb
      .insert(schema.lessons)
      .values({ moduleId: module.id, title: "A", position: 1 })
      .returning()
      .get();
    testDb
      .insert(schema.lessonProgress)
      .values({
        userId: base.user.id,
        lessonId: lesson.id,
        status: schema.LessonProgressStatus.Completed,
      })
      .run();
    testDb
      .insert(schema.videoWatchEvents)
      .values({
        userId: base.user.id,
        lessonId: lesson.id,
        eventType: "progress",
        positionSeconds: 3 * 60 * 60,
      })
      .run();
    const purchase = buyForTeamOn("2026-03-01");

    expect(offerOn(purchase.id, "2026-03-02")).toMatchObject({ ok: true });
  });

  describe("makeTeamPurchaseRefundRequest", () => {
    it("records a Pending Refund Request for the Team Purchase", () => {
      const purchase = buyForTeamOn("2026-03-01");

      const result = makeTeamPurchaseRefundRequest(testDb, {
        userId: base.user.id,
        purchaseId: purchase.id,
        reason: "The team changed direction.",
        now: new Date("2026-03-02T12:00:00"),
      });

      expect(result).toMatchObject({
        ok: true,
        refundRequest: {
          purchaseId: purchase.id,
          status: RefundRequestStatus.Pending,
        },
      });
    });

    it("refuses once any of its Coupons is Redeemed and records nothing", () => {
      const purchase = buyForTeamOn("2026-03-01");
      testDb
        .update(schema.coupons)
        .set({
          redeemedByUserId: admin.id,
          redeemedAt: new Date().toISOString(),
        })
        .where(eq(schema.coupons.purchaseId, purchase.id))
        .run();

      const result = makeTeamPurchaseRefundRequest(testDb, {
        userId: base.user.id,
        purchaseId: purchase.id,
        reason: "The team changed direction.",
        now: new Date("2026-03-02T12:00:00"),
      });

      expect(result).toMatchObject({ ok: false, code: "coupon-redeemed" });
      expect(hasRefundRequest(testDb, purchase.id)).toBe(false);
    });
  });

  describe("listTeamPurchasesForBuyer", () => {
    it("lists only the buyer's Team Purchases, each with its Coupons, Refund Request and offer", () => {
      const offered = buyForTeamOn("2026-03-01", 3, 15000);
      const requested = buyForTeamOn("2026-03-01", 2, 10000);
      requestRefund(requested.id);
      buyCourse(base.user.id);

      const listed = listTeamPurchasesForBuyer(testDb, {
        userId: base.user.id,
        now: new Date("2026-03-02T12:00:00"),
      });

      expect(listed).toMatchObject([
        {
          purchaseId: requested.id,
          courseTitle: "Test Course",
          amountPaid: 10000,
          couponCount: 2,
          redeemedCouponCount: 0,
          refundRequest: { status: RefundRequestStatus.Pending },
          offer: { ok: false, code: "already-requested" },
        },
        {
          purchaseId: offered.id,
          amountPaid: 15000,
          couponCount: 3,
          refundRequest: null,
          offer: { ok: true, amount: 15000, lastDayInWindow: "2026-03-15" },
        },
      ]);
    });

    it("lists no Team Purchases for someone who bought none", () => {
      buyForTeamOn("2026-03-01");

      expect(listTeamPurchasesForBuyer(testDb, { userId: admin.id })).toEqual(
        []
      );
    });
  });

  it("shows the buyer their Team Purchase's Refund Request in their own list, marked as a Team Purchase", () => {
    const teamPurchase = buyForTeamOn("2026-03-01");
    requestRefund(teamPurchase.id);
    requestRefund(buyCourse(base.user.id).id);

    const listed = listStudentRefundRequests(testDb, base.user.id);

    expect(
      listed
        .map((row) => ({
          purchaseId: row.purchaseId,
          isTeamPurchase: row.isTeamPurchase,
        }))
        .sort((a, b) => a.purchaseId - b.purchaseId)
    ).toEqual([
      { purchaseId: teamPurchase.id, isTeamPurchase: true },
      { purchaseId: teamPurchase.id + 1, isTeamPurchase: false },
    ]);
  });
});

describe("refusalReasonForStudent", () => {
  const error = "The reason.";

  it.each([
    "outside-refund-window",
    "completion-limit",
    "watch-time-limit",
    "joined-with-coupon",
  ] as const)("tells the Student why for %s", (code) => {
    expect(
      refusalReasonForStudent(
        code === "outside-refund-window"
          ? { ok: false, code, error, lastDay: "2026-03-15" }
          : { ok: false, code, error }
      )
    ).toBe(error);
  });

  it.each(["already-requested", "not-enrolled", "no-purchase"] as const)(
    "shows nothing for %s",
    (code) => {
      expect(refusalReasonForStudent({ ok: false, code, error })).toBeNull();
    }
  );
});

describe("refusalReasonForTeamPurchaseBuyer", () => {
  const error = "The reason.";

  it("tells the buyer why outside the Refund Window", () => {
    expect(
      refusalReasonForTeamPurchaseBuyer({
        ok: false,
        code: "outside-refund-window",
        error,
        lastDay: "2026-03-15",
      })
    ).toBe(error);
  });

  it("tells the buyer why once a Coupon has been Redeemed", () => {
    expect(
      refusalReasonForTeamPurchaseBuyer({
        ok: false,
        code: "coupon-redeemed",
        error,
      })
    ).toBe(error);
  });

  it("shows nothing once a Refund Request has been made, since its status shows instead", () => {
    expect(
      refusalReasonForTeamPurchaseBuyer({
        ok: false,
        code: "already-requested",
        error,
      })
    ).toBeNull();
  });
});

describe("formatCalendarDay", () => {
  it("writes a calendar day the way refund copy shows it", () => {
    expect(formatCalendarDay("2026-03-15")).toBe("March 15, 2026");
  });
});
