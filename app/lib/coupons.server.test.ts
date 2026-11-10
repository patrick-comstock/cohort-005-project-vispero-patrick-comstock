import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { redeemCoupon } from "./coupons.server";
import {
  makeRefundRequest,
  resolveRefundRequest,
} from "./refund-requests.server";

type TestDb = ReturnType<typeof createTestDb>;

let testDb: TestDb;
let base: ReturnType<typeof seedBaseData>;
let buyer: typeof schema.users.$inferSelect;

beforeEach(() => {
  testDb = createTestDb();
  base = seedBaseData(testDb);
  buyer = testDb
    .insert(schema.users)
    .values({
      name: "Bea Buyer",
      email: "buyer@example.com",
      role: schema.UserRole.Student,
    })
    .returning()
    .get();
});

function buyForTeam(couponCount = 2) {
  const team = testDb.insert(schema.teams).values({}).returning().get();
  const purchase = testDb
    .insert(schema.purchases)
    .values({
      userId: buyer.id,
      courseId: base.course.id,
      amountPaid: 9998,
      country: "US",
    })
    .returning()
    .get();
  const coupons = testDb
    .insert(schema.coupons)
    .values(
      Array.from({ length: couponCount }, (_, i) => ({
        teamId: team.id,
        courseId: base.course.id,
        code: `TEAM-${purchase.id}-${i}`,
        purchaseId: purchase.id,
      }))
    )
    .returning()
    .all();
  return { purchase, coupons };
}

function redeem(code: string) {
  return redeemCoupon(testDb, { code, userId: base.user.id, country: "US" });
}

describe("redeemCoupon", () => {
  it("enrolls the person who Redeems an unredeemed Coupon", () => {
    const { coupons } = buyForTeam();

    expect(redeem(coupons[0].code)).toMatchObject({
      ok: true,
      enrollment: { userId: base.user.id, courseId: base.course.id },
    });
  });

  it("refuses a Coupon whose Team Purchase has a Pending Refund Request", () => {
    const { purchase, coupons } = buyForTeam();
    makeRefundRequest(testDb, {
      purchaseId: purchase.id,
      reason: "The team changed direction.",
    });

    expect(redeem(coupons[0].code)).toMatchObject({
      ok: false,
      code: "refund-request-pending",
      error:
        "This Coupon can't be redeemed right now because its Team Purchase has a Pending Refund Request.",
    });
  });

  it("lets a Coupon be Redeemed again once its Team Purchase's Refund Request is Declined", () => {
    const { purchase, coupons } = buyForTeam();
    const admin = testDb
      .insert(schema.users)
      .values({
        name: "Ada Admin",
        email: "admin@example.com",
        role: schema.UserRole.Admin,
      })
      .returning()
      .get();
    const made = makeRefundRequest(testDb, {
      purchaseId: purchase.id,
      reason: "The team changed direction.",
    });
    if (!made.ok) throw new Error(made.error);
    resolveRefundRequest(testDb, {
      refundRequestId: made.refundRequest.id,
      adminUserId: admin.id,
      resolution: schema.RefundRequestStatus.Declined,
      resolutionNote: "Outside our policy.",
    });

    expect(redeem(coupons[0].code)).toMatchObject({ ok: true });
  });

  it("refuses a Voided Coupon", () => {
    const { coupons } = buyForTeam();
    testDb
      .update(schema.coupons)
      .set({ voidedAt: new Date().toISOString() })
      .run();

    expect(redeem(coupons[0].code)).toMatchObject({
      ok: false,
      code: "voided",
    });
  });

  it("refuses a Coupon that has already been Redeemed", () => {
    const { coupons } = buyForTeam();
    redeemCoupon(testDb, {
      code: coupons[0].code,
      userId: buyer.id,
      country: "US",
    });

    expect(redeem(coupons[0].code)).toMatchObject({
      ok: false,
      code: "already-redeemed",
    });
  });
});
