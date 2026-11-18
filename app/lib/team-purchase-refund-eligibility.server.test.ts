import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as schema from "~/db/schema";
import { NotificationKind, RefundRequestStatus, UserRole } from "~/db/schema";
import { createTestDb, seedBaseData } from "~/test/setup";

import { listNotifications } from "./notifications.server";
import {
  hasRefundRequest,
  makeRefundRequest,
} from "./refund-eligibility.server";
import { listRequesterRefundRequests } from "./refund-request-resolve.server";
import {
  getTeamPurchaseRefundRequestOffer,
  listTeamPurchasesForBuyer,
  makeTeamPurchaseRefundRequest,
  refusalReasonForTeamPurchaseBuyer,
} from "./team-purchase-refund-eligibility.server";

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

function makeAdmin(name: string, email: string) {
  return testDb
    .insert(schema.users)
    .values({ name, email, role: UserRole.Admin })
    .returning()
    .get();
}

/** What a user's Notifications say, without their ids and times. */
function notificationsFor(userId: number) {
  return listNotifications(testDb, userId).map(
    ({ kind, headline, body, link, readAt }) => ({
      kind,
      headline,
      body,
      link,
      readAt,
    })
  );
}

function requestRefund(purchaseId: number) {
  const result = makeRefundRequest(testDb, {
    purchaseId,
    reason: "The course was not what I expected.",
  });
  if (!result.ok) throw new Error(result.error);
  return result.refundRequest;
}

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
        createdAt: new Date(`${day}T09:00:00.000Z`).toISOString(),
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
      now: new Date(`${day}T12:00:00.000Z`),
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
        now: new Date("2026-03-02T12:00:00.000Z"),
      });

      expect(result).toMatchObject({
        ok: true,
        refundRequest: {
          purchaseId: purchase.id,
          status: RefundRequestStatus.Pending,
        },
      });
    });

    it("tells every Admin that it is for a Team Purchase", () => {
      const secondAdmin = makeAdmin("Bea Admin", "bea@example.com");
      const purchase = buyForTeamOn("2026-03-01", 3, 15000);

      const made = makeTeamPurchaseRefundRequest(testDb, {
        userId: base.user.id,
        purchaseId: purchase.id,
        reason: "The team changed direction.",
        now: new Date("2026-03-02T12:00:00.000Z"),
      });
      if (!made.ok) throw new Error(made.error);

      const expected = [
        {
          kind: NotificationKind.RefundRequestMade,
          headline:
            'Test User made a Refund Request for a Team Purchase of "Test Course"',
          body: "Refund if Approved: $150.00",
          link: `/admin/refund-requests/${made.refundRequest.id}`,
          readAt: null,
        },
      ];
      expect(notificationsFor(admin.id)).toEqual(expected);
      expect(notificationsFor(secondAdmin.id)).toEqual(expected);
      expect(notificationsFor(base.user.id)).toEqual([]);
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
        now: new Date("2026-03-02T12:00:00.000Z"),
      });

      expect(result).toMatchObject({ ok: false, code: "coupon-redeemed" });
      expect(hasRefundRequest(testDb, purchase.id)).toBe(false);
      expect(notificationsFor(admin.id)).toEqual([]);
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
        now: new Date("2026-03-02T12:00:00.000Z"),
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
