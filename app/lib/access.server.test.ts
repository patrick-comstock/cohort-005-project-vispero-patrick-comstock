import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { RefundRequestStatus, UserRole } from "~/db/schema";
import { findPurchaseForAccess, resolveAccess } from "./access.server";
import { makeRefundRequest } from "./refund-eligibility.server";
import { resolveRefundRequest } from "./refund-request-resolve.server";

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

function buyCourse(userId: number, amountPaid = 4999, country = "US") {
  const purchase = testDb
    .insert(schema.purchases)
    .values({ userId, courseId: base.course.id, amountPaid, country })
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

/** Gives the course a price, so a PPP Purchase can restrict where it is watched. */
function setCoursePricing(pppEnabled = true) {
  testDb
    .update(schema.courses)
    .set({ price: 9999, pppEnabled })
    .where(eq(schema.courses.id, base.course.id))
    .run();
}

function approveRefund(purchaseId: number) {
  resolveRefundRequest(testDb, {
    refundRequestId: requestRefund(purchaseId).id,
    adminUserId: admin.id,
    resolution: RefundRequestStatus.Approved,
  });
}

describe("resolveAccess", () => {
  it("treats a null user as signed out", () => {
    const access = resolveAccess(testDb, null, base.course.id, "US");

    expect(access).toMatchObject({
      userId: null,
      user: undefined,
      isStaff: false,
      enrolled: false,
      pppBlocked: false,
      canViewContent: false,
    });
  });

  it("treats an unknown user as signed out", () => {
    const access = resolveAccess(testDb, 9999, base.course.id, "US");

    expect(access.userId).toBeNull();
    expect(access.canViewContent).toBe(false);
  });

  it("lets the owning Instructor view content without an Enrollment", () => {
    const access = resolveAccess(
      testDb,
      base.instructor.id,
      base.course.id,
      "US"
    );

    expect(access).toMatchObject({
      userId: base.instructor.id,
      isOwningInstructor: true,
      isAdmin: false,
      isStaff: true,
      enrolled: false,
      canViewContent: true,
    });
  });

  it("lets an enrolled Student view content from the same country", () => {
    setCoursePricing();
    buyCourse(base.user.id, 2999, "IN");

    const access = resolveAccess(testDb, base.user.id, base.course.id, "IN");

    expect(access).toMatchObject({
      isStaff: false,
      enrolled: true,
      pppBlocked: false,
      canViewContent: true,
    });
  });

  it("blocks a PPP Purchase viewed from a different country", () => {
    setCoursePricing();
    buyCourse(base.user.id, 2999, "IN");

    const access = resolveAccess(testDb, base.user.id, base.course.id, "US");

    expect(access).toMatchObject({
      enrolled: true,
      pppBlocked: true,
      pppBlockedCountry: "US",
      pppPurchaseCountry: "IN",
      canViewContent: false,
    });
  });

  it("does not let a Refunded PPP Purchase block", () => {
    setCoursePricing();
    const refunded = buyCourse(base.user.id, 2999, "IN");
    approveRefund(refunded.id);
    // Enrolled again without a Purchase of their own, as by Redeeming a Coupon.
    testDb
      .insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();

    const access = resolveAccess(testDb, base.user.id, base.course.id, "BR");

    expect(access).toMatchObject({
      enrolled: true,
      pppBlocked: false,
      canViewContent: true,
    });
  });

  it("never blocks when the course has PPP turned off", () => {
    setCoursePricing(false);
    buyCourse(base.user.id, 2999, "IN");

    const access = resolveAccess(testDb, base.user.id, base.course.id, "US");

    expect(access.pppBlocked).toBe(false);
    expect(access.canViewContent).toBe(true);
  });

  it("never blocks an Admin", () => {
    setCoursePricing();
    buyCourse(admin.id, 2999, "IN");

    const access = resolveAccess(testDb, admin.id, base.course.id, "US");

    expect(access).toMatchObject({
      isAdmin: true,
      isStaff: true,
      enrolled: true,
      pppBlocked: false,
      canViewContent: true,
    });
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
