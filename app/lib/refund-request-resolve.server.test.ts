import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { RefundRequestStatus, UserRole } from "~/db/schema";
import {
  makeRefundRequest,
  makeTeamPurchaseRefundRequest,
} from "./refund-eligibility.server";
import {
  getRefundRequestDetail,
  listRefundRequests,
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

  function buyForTeam() {
    const team = testDb.insert(schema.teams).values({}).returning().get();
    const purchase = testDb
      .insert(schema.purchases)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        amountPaid: 4999 * 2,
        country: "US",
      })
      .returning()
      .get();
    testDb
      .insert(schema.coupons)
      .values(
        [0, 1].map((i) => ({
          teamId: team.id,
          courseId: base.course.id,
          code: `TEAM-${purchase.id}-${i}`,
          purchaseId: purchase.id,
        }))
      )
      .run();
    return purchase;
  }

  function approve(refundRequestId: number) {
    resolveRefundRequest(testDb, {
      refundRequestId,
      adminUserId: admin.id,
      resolution: RefundRequestStatus.Approved,
    });
  }

  it("does not count an Approved Team Purchase Refund Request towards an individual one", () => {
    approve(requestRefund(buyForTeam().id).id);
    const individual = requestRefund(buyCourse(base.user.id).id);

    expect(listRefundRequests(testDb).pending).toMatchObject([
      { id: individual.id, earlierApprovedCount: 0 },
    ]);
  });

  it("does not count an Approved individual Refund Request towards a Team Purchase one", () => {
    refundAndBuyAgain("approve");
    const teamPurchase = requestRefund(buyForTeam().id);

    expect(listRefundRequests(testDb).pending).toMatchObject([
      { id: teamPurchase.id, earlierApprovedCount: 0 },
    ]);
  });

  it("counts earlier Approved Team Purchase Refund Requests towards a Team Purchase one", () => {
    approve(requestRefund(buyForTeam().id).id);
    const teamPurchase = requestRefund(buyForTeam().id);

    expect(listRefundRequests(testDb).pending).toMatchObject([
      { id: teamPurchase.id, earlierApprovedCount: 1 },
    ]);
  });

  it("counts an earlier Refund Request Approved after this one was made", () => {
    const earlier = requestRefund(buyCourse(base.user.id).id);
    const latest = requestRefund(buyCourse(base.user.id).id);
    approve(earlier.id);

    expect(listRefundRequests(testDb).pending).toMatchObject([
      { id: latest.id, earlierApprovedCount: 1 },
    ]);
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

    expect(detail?.watchTimeAndCompletion).toEqual({
      watchedSeconds: 360,
      completion: 0.5,
    });
  });

  it("leaves out watch time and completion for a Team Purchase, even when the buyer is separately enrolled", () => {
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
      .insert(schema.videoWatchEvents)
      .values({
        userId: base.user.id,
        lessonId: lesson.id,
        eventType: "progress",
        positionSeconds: 300,
      })
      .run();
    buyCourse(base.user.id);
    const team = testDb.insert(schema.teams).values({}).returning().get();
    const teamPurchase = testDb
      .insert(schema.purchases)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        amountPaid: 4999 * 2,
        country: "US",
      })
      .returning()
      .get();
    testDb
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code: "TEAM-DETAIL-1",
        purchaseId: teamPurchase.id,
      })
      .run();
    const result = makeTeamPurchaseRefundRequest(testDb, {
      userId: base.user.id,
      purchaseId: teamPurchase.id,
      reason: "The team changed direction.",
      now: new Date(),
    });
    if (!result.ok) throw new Error(result.error);

    const detail = getRefundRequestDetail(testDb, result.refundRequest.id);

    expect(detail).toMatchObject({
      isTeamPurchase: true,
      watchTimeAndCompletion: null,
    });
  });

  it("counts a Team Purchase's Coupons and how many were Redeemed", () => {
    const team = testDb.insert(schema.teams).values({}).returning().get();
    const teamPurchase = testDb
      .insert(schema.purchases)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        amountPaid: 4999 * 3,
        country: "US",
      })
      .returning()
      .get();
    const redeemer = testDb
      .insert(schema.users)
      .values({
        name: "Rae Redeemer",
        email: "rae@example.com",
        role: UserRole.Student,
      })
      .returning()
      .get();
    testDb
      .insert(schema.coupons)
      .values([
        {
          teamId: team.id,
          courseId: base.course.id,
          code: "TEAM-COUNT-1",
          purchaseId: teamPurchase.id,
          redeemedByUserId: redeemer.id,
          redeemedAt: new Date().toISOString(),
        },
        {
          teamId: team.id,
          courseId: base.course.id,
          code: "TEAM-COUNT-2",
          purchaseId: teamPurchase.id,
        },
        {
          teamId: team.id,
          courseId: base.course.id,
          code: "TEAM-COUNT-3",
          purchaseId: teamPurchase.id,
        },
      ])
      .run();
    const refundRequest = requestRefund(teamPurchase.id);

    const detail = getRefundRequestDetail(testDb, refundRequest.id);

    expect(detail?.couponCounts).toEqual({ coupons: 3, redeemed: 1 });
  });

  it("has no Coupon counts for an individual Purchase", () => {
    const refundRequest = requestRefund(buyCourse(base.user.id).id);

    const detail = getRefundRequestDetail(testDb, refundRequest.id);

    expect(detail?.couponCounts).toBeNull();
  });
});

describe("listRequesterRefundRequests", () => {
  it("shows the Student their Pending and Resolved Refund Requests, newest first", () => {
    const first = buyCourse(base.user.id, 2500);
    resolveRefundRequest(testDb, {
      refundRequestId: requestRefund(first.id).id,
      adminUserId: admin.id,
      resolution: RefundRequestStatus.Approved,
      resolutionNote: "Sorry it was not a fit.",
    });
    const pending = requestRefund(buyCourse(base.user.id).id);

    expect(listRequesterRefundRequests(testDb, base.user.id)).toMatchObject([
      { id: pending.id, status: RefundRequestStatus.Pending },
      {
        status: RefundRequestStatus.Approved,
        refundAmount: 2500,
        resolutionNote: "Sorry it was not a fit.",
      },
    ]);
  });
});
