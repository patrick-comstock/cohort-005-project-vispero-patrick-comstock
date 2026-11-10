import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { RefundRequestStatus, UserRole } from "~/db/schema";
import { findPurchaseForAccess } from "./access.server";
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
