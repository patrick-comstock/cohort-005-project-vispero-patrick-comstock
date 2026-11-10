import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { RefundRequestStatus, UserRole } from "~/db/schema";
import {
  makeRefundRequest,
  resolveRefundRequest,
} from "./refund-requests.server";
import {
  getBuyerCount,
  getCourseRevenueByCountry,
  getRevenueByCourse,
  getRevenueOverTime,
  getRevenueSummary,
  getStudentRevenue,
  getTopBuyers,
} from "./revenue.server";

type TestDb = ReturnType<typeof createTestDb>;

let testDb: TestDb;
let base: ReturnType<typeof seedBaseData>;
let admin: typeof schema.users.$inferSelect;

const allTime = { instructorId: null, range: "all" } as const;

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

function addStudent(name: string) {
  return testDb
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
      role: UserRole.Student,
    })
    .returning()
    .get();
}

function buyCourse(
  userId: number,
  amountPaid: number,
  options: { courseId?: number; country?: string; createdAt?: string } = {}
) {
  return testDb
    .insert(schema.purchases)
    .values({
      userId,
      courseId: options.courseId ?? base.course.id,
      amountPaid,
      country: options.country ?? "US",
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    })
    .returning()
    .get();
}

function enroll(userId: number) {
  testDb
    .insert(schema.enrollments)
    .values({ userId, courseId: base.course.id })
    .run();
}

function addCourse(title: string) {
  return testDb
    .insert(schema.courses)
    .values({
      title,
      slug: title.toLowerCase().replace(/\s+/g, "-"),
      description: title,
      salesCopy: title,
      instructorId: base.instructor.id,
      categoryId: base.category.id,
      status: schema.CourseStatus.Published,
    })
    .returning()
    .get();
}

/** A Team Purchase with `couponCount` Coupons, none Redeemed. */
function buyForTeam(userId: number, amountPaid: number, couponCount: number) {
  const purchase = buyCourse(userId, amountPaid);
  const team = testDb.insert(schema.teams).values({}).returning().get();
  for (let i = 0; i < couponCount; i++) {
    testDb
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code: `TEAM-${purchase.id}-${i}`,
        purchaseId: purchase.id,
      })
      .run();
  }
  return purchase;
}

function resolve(
  purchaseId: number,
  resolution: RefundRequestStatus.Approved | RefundRequestStatus.Declined
) {
  const made = makeRefundRequest(testDb, {
    purchaseId,
    reason: "The course was not what I expected.",
  });
  if (!made.ok) throw new Error(made.error);
  const resolved = resolveRefundRequest(testDb, {
    refundRequestId: made.refundRequest.id,
    adminUserId: admin.id,
    resolution,
    resolutionNote: "Noted.",
  });
  if (!resolved.ok) throw new Error(resolved.error);
}

const refund = (purchaseId: number) =>
  resolve(purchaseId, RefundRequestStatus.Approved);

describe("getRevenueSummary", () => {
  it("takes Refunds off Gross Sales to give Revenue, and charges the fee on Revenue", () => {
    buyCourse(base.user.id, 10000);
    const refunded = buyCourse(addStudent("Rory Refunded").id, 5000);
    refund(refunded.id);

    expect(getRevenueSummary(testDb, allTime)).toEqual({
      grossSalesCents: 15000,
      refundCents: 5000,
      refundCount: 1,
      revenueCents: 10000,
      feeCents: 2000,
      netEarningsCents: 8000,
      purchaseCount: 1,
    });
  });

  it("counts Purchases with a Pending or Declined Refund Request in full", () => {
    buyCourse(base.user.id, 4000);
    makeRefundRequest(testDb, {
      purchaseId: buyCourse(addStudent("Pat Pending").id, 3000).id,
      reason: "Changed my mind.",
    });
    resolve(
      buyCourse(addStudent("Dee Declined").id, 2000).id,
      RefundRequestStatus.Declined
    );

    expect(getRevenueSummary(testDb, allTime)).toMatchObject({
      grossSalesCents: 9000,
      refundCents: 0,
      refundCount: 0,
      revenueCents: 9000,
      purchaseCount: 3,
    });
  });

  it("counts a Refund on its Purchase's date, not the date it was Approved", () => {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86_400_000).toISOString();
    refund(buyCourse(base.user.id, 5000, { createdAt: sixtyDaysAgo }).id);
    buyCourse(addStudent("Nina Now").id, 3000);

    expect(
      getRevenueSummary(testDb, { instructorId: null, range: "30d" })
    ).toMatchObject({
      grossSalesCents: 3000,
      refundCents: 0,
      refundCount: 0,
      revenueCents: 3000,
    });
  });
});

describe("getRevenueByCourse", () => {
  it("gives each course its Revenue, biggest first, and leaves out a course whose every Purchase was Refunded", () => {
    const small = addCourse("Small Course");
    const refundedOnly = addCourse("Refunded Course");
    buyCourse(base.user.id, 10000);
    refund(buyCourse(addStudent("Rory Refunded").id, 10000).id);
    buyCourse(base.user.id, 3000, { courseId: small.id });
    refund(buyCourse(base.user.id, 9000, { courseId: refundedOnly.id }).id);

    expect(getRevenueByCourse(testDb, allTime)).toEqual([
      {
        courseId: base.course.id,
        title: "Test Course",
        revenueCents: 10000,
        feeCents: 2000,
        netEarningsCents: 8000,
        purchaseCount: 1,
      },
      {
        courseId: small.id,
        title: "Small Course",
        revenueCents: 3000,
        feeCents: 600,
        netEarningsCents: 2400,
        purchaseCount: 1,
      },
    ]);
  });
});

describe("getRevenueOverTime", () => {
  it("charts Revenue and Net Earnings, so a month whose sales were all Refunded sits at zero", () => {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86_400_000).toISOString();
    refund(buyCourse(base.user.id, 5000, { createdAt: sixtyDaysAgo }).id);
    buyCourse(addStudent("Nina Now").id, 3000);

    const series = getRevenueOverTime(testDb, allTime);
    const pointFor = (iso: string) =>
      series.points.find((point) => point.bucket === iso.slice(0, 7));

    expect(series.granularity).toBe("month");
    expect(pointFor(sixtyDaysAgo)).toMatchObject({
      revenueCents: 0,
      netEarningsCents: 0,
    });
    expect(pointFor(new Date().toISOString())).toMatchObject({
      revenueCents: 3000,
      netEarningsCents: 2400,
    });
  });
});

describe("getBuyerCount", () => {
  it("counts only people with a Purchase that was not Refunded", () => {
    buyCourse(base.user.id, 4000);
    refund(buyCourse(addStudent("Rory Refunded").id, 4000).id);

    expect(getBuyerCount(testDb, allTime)).toBe(1);
  });
});

describe("getTopBuyers", () => {
  it("ranks buyers by spend after Refunds and counts only Purchases they kept", () => {
    const keeper = addStudent("Kim Keeper");
    const mixed = addStudent("Max Mixed");
    buyCourse(keeper.id, 6000);
    buyCourse(mixed.id, 5000);
    refund(buyCourse(mixed.id, 9000).id);

    expect(
      getTopBuyers(testDb, allTime).map(
        ({ name, spendCents, purchaseCount }) => ({
          name,
          spendCents,
          purchaseCount,
        })
      )
    ).toEqual([
      { name: "Kim Keeper", spendCents: 6000, purchaseCount: 1 },
      { name: "Max Mixed", spendCents: 5000, purchaseCount: 1 },
    ]);
  });

  it("leaves out anyone whose spend after Refunds is zero", () => {
    buyCourse(base.user.id, 4000);
    refund(buyForTeam(addStudent("Tess Team").id, 20000, 4).id);

    expect(getTopBuyers(testDb, allTime).map((buyer) => buyer.name)).toEqual([
      "Test User",
    ]);
  });

  it("leaves Coupons from a Refunded Team Purchase out of a buyer's Coupon counts", () => {
    const buyer = addStudent("Tess Team");
    buyForTeam(buyer.id, 10000, 2);
    refund(buyForTeam(buyer.id, 20000, 4).id);

    expect(getTopBuyers(testDb, allTime)).toMatchObject([
      { name: "Tess Team", couponsBought: 2, couponsUnredeemed: 2 },
    ]);
  });
});

describe("getStudentRevenue", () => {
  it("credits a Student who bought again after a Refund with only the Purchase they kept", () => {
    refund(buyCourse(base.user.id, 5000).id);
    buyCourse(base.user.id, 4000);
    enroll(base.user.id);

    expect(getStudentRevenue(testDb, allTime)).toEqual([
      { userId: base.user.id, name: "Test User", revenueCents: 4000 },
    ]);
  });
});

describe("getCourseRevenueByCountry", () => {
  it("breaks a course's Revenue down by country, leaving out a country whose every Purchase was Refunded", () => {
    buyCourse(base.user.id, 7000, { country: "US" });
    refund(
      buyCourse(addStudent("Rory Refunded").id, 5000, { country: "US" }).id
    );
    buyCourse(addStudent("Indira India").id, 3000, { country: "IN" });
    refund(
      buyCourse(addStudent("Bruno Brazil").id, 4000, { country: "BR" }).id
    );

    const breakdown = getCourseRevenueByCountry(testDb, base.course.id, "all");

    expect(breakdown).toMatchObject({
      revenueCents: 10000,
      netEarningsCents: 8000,
      purchaseCount: 2,
      discountedRevenueCents: 3000,
      discountedNetEarningsCents: 2400,
      discountedSharePercent: 30,
    });
    expect(breakdown.rows).toMatchObject([
      {
        country: "US",
        purchaseCount: 1,
        revenueCents: 7000,
        netEarningsCents: 5600,
        sharePercent: 70,
        averagePaidCents: 7000,
      },
      {
        country: "IN",
        purchaseCount: 1,
        revenueCents: 3000,
        netEarningsCents: 2400,
        sharePercent: 30,
        averagePaidCents: 3000,
      },
    ]);
  });
});
