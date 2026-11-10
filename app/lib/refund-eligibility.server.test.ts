import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { RefundRequestStatus, UserRole } from "~/db/schema";
import {
  formatCalendarDay,
  getRefundRequestOffer,
  getRefundRequestPurchase,
  getStudentRefundRequest,
  getTeamPurchaseRefundRequestOffer,
  hasRefundRequest,
  listTeamPurchasesForBuyer,
  makeRefundRequest,
  makeStudentRefundRequest,
  makeTeamPurchaseRefundRequest,
  refusalReasonForStudent,
  refusalReasonForTeamPurchaseBuyer,
} from "./refund-eligibility.server";
import {
  listRequesterRefundRequests,
  resolveRefundRequest,
} from "./refund-request-resolve.server";

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

  it("makes no offer to a buyer who Redeemed a Coupon from their own Team Purchase, and says why", () => {
    const team = testDb.insert(schema.teams).values({}).returning().get();
    const teamPurchase = testDb
      .insert(schema.purchases)
      .values({
        userId: base.user.id,
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
        code: "TEAM-OWN",
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
      code: "joined-with-own-coupon",
      error:
        "You joined this course with a Coupon from your own Team Purchase. A Team Purchase can't be Refunded once one of its Coupons has been Redeemed.",
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

  describe("makeStudentRefundRequest", () => {
    function makeOn(day: string) {
      return makeStudentRefundRequest(testDb, {
        userId: base.user.id,
        courseId: base.course.id,
        reason: "The course was not what I expected.",
        now: new Date(`${day}T12:00:00`),
      });
    }

    it("records a Pending Refund Request for the Student's Purchase", () => {
      const purchase = buyCourseOn("2026-03-01", 2500);

      expect(makeOn("2026-03-02")).toMatchObject({
        ok: true,
        amount: 2500,
        refundRequest: {
          purchaseId: purchase.id,
          status: RefundRequestStatus.Pending,
        },
      });
    });

    it("refuses outside the Refund Window and records nothing", () => {
      const purchase = buyCourseOn("2026-03-01");

      expect(makeOn("2026-03-16")).toMatchObject({
        ok: false,
        code: "outside-refund-window",
      });
      expect(hasRefundRequest(testDb, purchase.id)).toBe(false);
    });

    it("refuses a second Refund Request for the same Purchase", () => {
      buyCourseOn("2026-03-01");
      makeOn("2026-03-02");

      expect(makeOn("2026-03-03")).toMatchObject({
        ok: false,
        code: "already-requested",
      });
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
      error: "Refunds aren't available once a Coupon has been Redeemed.",
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

    const listed = listRequesterRefundRequests(testDb, base.user.id);

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

describe("getStudentRefundRequest", () => {
  const course = () => ({ userId: base.user.id, courseId: base.course.id });

  it("shows nothing before the Student makes a Refund Request", () => {
    buyCourse(base.user.id);

    expect(getStudentRefundRequest(testDb, course())).toBeNull();
  });

  it("shows a Pending Refund Request for the Student's Purchase", () => {
    requestRefund(buyCourse(base.user.id).id);

    expect(getStudentRefundRequest(testDb, course())).toEqual({
      status: RefundRequestStatus.Pending,
      resolutionNote: null,
    });
  });

  it("still shows an Approved Refund Request and its Resolution Note after the Enrollment ends", () => {
    const purchase = buyCourse(base.user.id);
    resolveRefundRequest(testDb, {
      refundRequestId: requestRefund(purchase.id).id,
      adminUserId: admin.id,
      resolution: RefundRequestStatus.Approved,
      resolutionNote: "Sorry it wasn't a fit.",
    });

    expect(getStudentRefundRequest(testDb, course())).toEqual({
      status: RefundRequestStatus.Approved,
      resolutionNote: "Sorry it wasn't a fit.",
    });
  });

  it("shows nothing once the Student buys the course again after a Refund", () => {
    const first = buyCourse(base.user.id);
    resolveRefundRequest(testDb, {
      refundRequestId: requestRefund(first.id).id,
      adminUserId: admin.id,
      resolution: RefundRequestStatus.Approved,
    });
    buyCourse(base.user.id);

    expect(getStudentRefundRequest(testDb, course())).toBeNull();
  });
});

describe("refusalReasonForStudent", () => {
  const error = "The reason.";

  it.each([
    "outside-refund-window",
    "completion-limit",
    "watch-time-limit",
    "joined-with-coupon",
    "joined-with-own-coupon",
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
