import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  inArray,
  isNull,
  notExists,
  sql,
  sum,
} from "drizzle-orm";
import {
  coupons,
  courses,
  enrollments,
  purchases,
  refundRequests,
  RefundRequestStatus,
  users,
} from "~/db/schema";
import { rangeStart, splitRevenue, type AnalyticsRange } from "~/lib/analytics";
import {
  ownedBy,
  scopeOn,
  sinceRange,
  type AnalyticsScope,
} from "~/lib/analytics-scope.server";
import { getDiscountForCountry } from "~/lib/ppp";
import type { Db } from "~/lib/refund-requests.server";

// ─── Revenue ───
// What an instructor's sales brought in, and what they kept. Gross Sales is
// what was paid; Revenue is Gross Sales minus Refunds; Net Earnings is Revenue
// minus the platform fee.
//
// A Refund is the refund amount on an Approved Refund Request (ADR 0003).
// Pending and Declined Refund Requests have no Refund, so their Purchases
// count in full. A Refund counts against its Purchase's date, not the date it
// was Approved, so a range means "sales made then, and kept".

/**
 * Joins each Purchase to its Refund, if it has one. A Purchase has at most one
 * Refund Request (ADR 0002), so this never repeats a Purchase.
 */
const approvedRefundRequest = and(
  eq(refundRequests.purchaseId, purchases.id),
  eq(refundRequests.status, RefundRequestStatus.Approved)
);

/** A Purchase's Refund in cents — zero when it has none. */
const refundOf = sql<number>`coalesce(${refundRequests.refundAmount}, 0)`;

/** Revenue across the grouped Purchases: what was paid, minus Refunds. */
const revenueSum = sql<number>`coalesce(sum(${purchases.amountPaid} - ${refundOf}), 0)`;

/** How many of the grouped Purchases were not Refunded. */
const keptPurchaseCount = sql<number>`coalesce(sum(case when ${refundRequests.id} is null then 1 else 0 end), 0)`;

export type RevenueSummary = {
  grossSalesCents: number;
  refundCents: number;
  refundCount: number;
  revenueCents: number;
  feeCents: number;
  netEarningsCents: number;
  /** Purchases in the range that were not Refunded. */
  purchaseCount: number;
};

/** Gross Sales, Refunds, Revenue, the platform fee and Net Earnings. */
export function getRevenueSummary(
  database: Db,
  { instructorId, range }: AnalyticsScope
): RevenueSummary {
  const row = database
    .select({
      grossSales: sum(purchases.amountPaid),
      refunds: sum(refundRequests.refundAmount),
      refundCount: count(refundRequests.id),
      revenue: revenueSum,
      purchaseCount: keptPurchaseCount,
    })
    .from(purchases)
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .leftJoin(refundRequests, approvedRefundRequest)
    .where(scopeOn(purchases.createdAt, instructorId, range))
    .get();

  // sum() returns null over an empty set, and a string when SQLite has rows.
  return {
    grossSalesCents: Number(row?.grossSales ?? 0),
    refundCents: Number(row?.refunds ?? 0),
    refundCount: row?.refundCount ?? 0,
    ...splitRevenue(Number(row?.revenue ?? 0)),
    purchaseCount: Number(row?.purchaseCount ?? 0),
  };
}

export type CourseRevenue = {
  courseId: number;
  title: string;
  revenueCents: number;
  feeCents: number;
  netEarningsCents: number;
  purchaseCount: number;
};

/**
 * Revenue by course, biggest earner first. A course with no Purchases kept in
 * the range — none made, or every one Refunded — is absent rather than listed
 * at zero.
 */
export function getRevenueByCourse(
  database: Db,
  { instructorId, range }: AnalyticsScope
): CourseRevenue[] {
  return database
    .select({
      courseId: courses.id,
      title: courses.title,
      revenue: revenueSum,
      purchaseCount: keptPurchaseCount,
    })
    .from(purchases)
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .leftJoin(refundRequests, approvedRefundRequest)
    .where(scopeOn(purchases.createdAt, instructorId, range))
    .groupBy(courses.id)
    .all()
    .map((row) => ({
      courseId: row.courseId,
      title: row.title,
      ...splitRevenue(Number(row.revenue)),
      purchaseCount: Number(row.purchaseCount),
    }))
    .filter((row) => row.purchaseCount > 0)
    .sort((a, b) => b.revenueCents - a.revenueCents);
}

/**
 * The courses that had Purchases in the range but kept none: every one was
 * Refunded. `getRevenueByCourse` leaves these out, so this tells "all sales
 * Refunded" apart from "no sales at all".
 */
export function getFullyRefundedCourseIds(
  database: Db,
  { instructorId, range }: AnalyticsScope
): number[] {
  return database
    .select({ courseId: courses.id })
    .from(purchases)
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .leftJoin(refundRequests, approvedRefundRequest)
    .where(scopeOn(purchases.createdAt, instructorId, range))
    .groupBy(courses.id)
    .having(sql`${keptPurchaseCount} = 0`)
    .orderBy(courses.id)
    .all()
    .map((row) => row.courseId);
}

export type RevenuePoint = {
  bucket: string;
  revenueCents: number;
  netEarningsCents: number;
};

export type RevenueSeries = {
  granularity: "day" | "month";
  points: RevenuePoint[];
};

/** The bucket an ISO timestamp falls in, at the given granularity. */
function bucketOf(iso: string, granularity: "day" | "month"): string {
  return iso.slice(0, granularity === "day" ? 10 : 7);
}

/** Every bucket from `first` to `last` inclusive, with none skipped. */
function bucketRange(
  first: string,
  last: string,
  granularity: "day" | "month"
): string[] {
  const buckets: string[] = [];
  const cursor = new Date(
    `${first}${granularity === "day" ? "" : "-01"}T00:00:00.000Z`
  );

  while (bucketOf(cursor.toISOString(), granularity) <= last) {
    buckets.push(bucketOf(cursor.toISOString(), granularity));
    if (granularity === "day") {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    } else {
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }

  return buckets;
}

/** Revenue and Net Earnings per day, or per month for all time. */
export function getRevenueOverTime(
  database: Db,
  { instructorId, range }: AnalyticsScope
): RevenueSeries {
  const granularity = range === "all" ? "month" : "day";
  const bucketExpr = sql<string>`substr(${purchases.createdAt}, 1, ${
    granularity === "day" ? 10 : 7
  })`;

  const rows = database
    .select({ bucket: bucketExpr, revenue: revenueSum })
    .from(purchases)
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .leftJoin(refundRequests, approvedRefundRequest)
    .where(scopeOn(purchases.createdAt, instructorId, range))
    .groupBy(bucketExpr)
    .orderBy(bucketExpr)
    .all();

  if (rows.length === 0 && range === "all") return { granularity, points: [] };

  const revenueByBucket = new Map(
    rows.map((row) => [row.bucket, Number(row.revenue)])
  );

  const now = new Date().toISOString();
  // A fixed range always spans its whole window, even before the first sale;
  // all time can only start where the data does.
  const start = rangeStart(range) ?? rows[0].bucket;

  const points = bucketRange(
    bucketOf(start, granularity),
    bucketOf(now, granularity),
    granularity
  ).map((bucket) => {
    const { revenueCents, netEarningsCents } = splitRevenue(
      revenueByBucket.get(bucket) ?? 0
    );
    return { bucket, revenueCents, netEarningsCents };
  });

  return { granularity, points };
}

/**
 * How many people paid and kept at least one Purchase. A team buying several
 * Coupons counts once.
 */
export function getBuyerCount(
  database: Db,
  { instructorId, range }: AnalyticsScope
): number {
  const row = database
    .select({ buyerCount: countDistinct(purchases.userId) })
    .from(purchases)
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .leftJoin(refundRequests, approvedRefundRequest)
    .where(
      and(
        scopeOn(purchases.createdAt, instructorId, range),
        isNull(refundRequests.id)
      )
    )
    .get();

  return row?.buyerCount ?? 0;
}

export type TopBuyer = {
  userId: number;
  name: string;
  email: string;
  spendCents: number;
  purchaseCount: number;
  couponsBought: number;
  couponsUnredeemed: number;
  enrolled: boolean;
};

const TOP_BUYER_LIMIT = 10;

/**
 * The biggest spenders, ranked by spend after Refunds. Anyone whose spend
 * after Refunds is zero is left out.
 */
export function getTopBuyers(
  database: Db,
  { instructorId, range }: AnalyticsScope
): TopBuyer[] {
  const buyers = database
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      spend: revenueSum,
      purchaseCount: keptPurchaseCount,
    })
    .from(purchases)
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .innerJoin(users, eq(users.id, purchases.userId))
    .leftJoin(refundRequests, approvedRefundRequest)
    .where(scopeOn(purchases.createdAt, instructorId, range))
    .groupBy(users.id)
    .having(sql`${revenueSum} > 0`)
    .orderBy(desc(revenueSum))
    .limit(TOP_BUYER_LIMIT)
    .all();

  if (buyers.length === 0) return [];

  const buyerIds = buyers.map((buyer) => buyer.userId);

  // Coupons are counted in their own query: joining coupons to purchases above
  // would repeat each purchase once per Coupon and multiply the spend the
  // leaderboard ranks on. Coupons from a Refunded Team Purchase are Voided, so
  // they are left out.
  const couponTotals = database
    .select({
      userId: purchases.userId,
      bought: count(coupons.id),
      unredeemed: sql<number>`sum(case when ${coupons.redeemedByUserId} is null then 1 else 0 end)`,
    })
    .from(coupons)
    .innerJoin(purchases, eq(coupons.purchaseId, purchases.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .leftJoin(refundRequests, approvedRefundRequest)
    .where(
      and(
        inArray(purchases.userId, buyerIds),
        scopeOn(purchases.createdAt, instructorId, range),
        isNull(refundRequests.id)
      )
    )
    .groupBy(purchases.userId)
    .all();

  const couponsByUser = new Map(couponTotals.map((row) => [row.userId, row]));

  // No range here: "never enrolled" is a fact about the person, not about the
  // last thirty days.
  const enrolled = new Set(
    database
      .selectDistinct({ userId: enrollments.userId })
      .from(enrollments)
      .innerJoin(courses, eq(enrollments.courseId, courses.id))
      .where(and(inArray(enrollments.userId, buyerIds), ownedBy(instructorId)))
      .all()
      .map((row) => row.userId)
  );

  return buyers.map((buyer) => ({
    userId: buyer.userId,
    name: buyer.name,
    email: buyer.email,
    spendCents: Number(buyer.spend),
    purchaseCount: Number(buyer.purchaseCount),
    couponsBought: couponsByUser.get(buyer.userId)?.bought ?? 0,
    couponsUnredeemed: Number(couponsByUser.get(buyer.userId)?.unredeemed ?? 0),
    enrolled: enrolled.has(buyer.userId),
  }));
}

export type StudentRevenue = {
  userId: number;
  name: string;
  revenueCents: number;
};

/**
 * Each enrolled Student, with the Revenue they brought in: their own Purchases
 * plus their share of any Team Purchase whose Coupon they Redeemed.
 */
export function getStudentRevenue(
  database: Db,
  { instructorId, range }: AnalyticsScope
): StudentRevenue[] {
  const students = database
    .selectDistinct({ userId: users.id, name: users.name })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .innerJoin(users, eq(users.id, enrollments.userId))
    .where(scopeOn(enrollments.enrolledAt, instructorId, range))
    .orderBy(users.name)
    .all();

  if (students.length === 0) return [];

  const studentIds = students.map((student) => student.userId);

  // Correlated: did this purchase mint Coupons for other people?
  const mintedCoupons = database
    .select({ one: sql`1` })
    .from(coupons)
    .where(eq(coupons.purchaseId, purchases.id));

  const direct = database
    .select({ userId: purchases.userId, paid: revenueSum })
    .from(purchases)
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .leftJoin(refundRequests, approvedRefundRequest)
    .where(
      and(
        inArray(purchases.userId, studentIds),
        notExists(mintedCoupons),
        ownedBy(instructorId)
      )
    )
    .groupBy(purchases.userId)
    .all();

  const couponCounts = database
    .select({
      purchaseId: coupons.purchaseId,
      couponCount: count().as("coupon_count"),
    })
    .from(coupons)
    .groupBy(coupons.purchaseId)
    .as("coupon_counts");

  // A Team Purchase can only be Refunded while none of its Coupons has been
  // Redeemed, so a Redeemed Coupon's share is never Refunded in practice. The
  // Refund is taken off anyway, so the figure stays right if that changes.
  const viaCoupon = database
    .select({
      userId: coupons.redeemedByUserId,
      // Divided rather than rounded per row: the shares are summed first and
      // rounded once, so five Coupons out of 3333 cents still add up.
      paid: sql<number>`sum((${purchases.amountPaid} - ${refundOf}) * 1.0 / ${couponCounts.couponCount})`,
    })
    .from(coupons)
    .innerJoin(purchases, eq(coupons.purchaseId, purchases.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .innerJoin(couponCounts, eq(couponCounts.purchaseId, coupons.purchaseId))
    .leftJoin(refundRequests, approvedRefundRequest)
    .where(
      and(inArray(coupons.redeemedByUserId, studentIds), ownedBy(instructorId))
    )
    .groupBy(coupons.redeemedByUserId)
    .all();

  const paidByUser = new Map<number, number>();
  const credit = (userId: number | null, paid: unknown) => {
    if (userId === null) return;
    paidByUser.set(userId, (paidByUser.get(userId) ?? 0) + Number(paid ?? 0));
  };

  for (const row of direct) credit(row.userId, row.paid);
  for (const row of viaCoupon) credit(row.userId, row.paid);

  return students.map((student) => ({
    ...student,
    revenueCents: Math.round(paidByUser.get(student.userId) ?? 0),
  }));
}

export type CountryRevenueRow = {
  country: string | null;
  purchaseCount: number;
  revenueCents: number;
  netEarningsCents: number;
  sharePercent: number;
  averagePaidCents: number;
  discountPercent: number | null;
};

export type CourseCountryRevenue = {
  revenueCents: number;
  netEarningsCents: number;
  purchaseCount: number;
  discountedRevenueCents: number;
  discountedNetEarningsCents: number;
  discountedSharePercent: number;
  rows: CountryRevenueRow[];
};

/**
 * One course's Revenue by the country each Purchase was made from, biggest
 * first. A country with no Purchases kept is absent.
 */
export function getCourseRevenueByCountry(
  database: Db,
  courseId: number,
  range: AnalyticsRange
): CourseCountryRevenue {
  const rows = database
    .select({
      country: purchases.country,
      revenue: revenueSum,
      purchaseCount: keptPurchaseCount,
    })
    .from(purchases)
    .leftJoin(refundRequests, approvedRefundRequest)
    .where(
      and(
        eq(purchases.courseId, courseId),
        sinceRange(purchases.createdAt, range)
      )
    )
    .groupBy(purchases.country)
    .all()
    .map((row) => ({
      country: row.country,
      revenueCents: Number(row.revenue),
      purchaseCount: Number(row.purchaseCount),
    }))
    .filter((row) => row.purchaseCount > 0)
    .sort((a, b) => b.revenueCents - a.revenueCents);

  const revenueCents = rows.reduce((total, row) => total + row.revenueCents, 0);
  const purchaseCount = rows.reduce(
    (total, row) => total + row.purchaseCount,
    0
  );

  const share = (cents: number) =>
    revenueCents === 0 ? 0 : Math.round((cents / revenueCents) * 100);

  let discountedRevenueCents = 0;

  const breakdown = rows.map((row) => {
    const discountPercent =
      row.country === null ? null : getDiscountForCountry(row.country) * 100;

    if (discountPercent !== null && discountPercent > 0) {
      discountedRevenueCents += row.revenueCents;
    }

    return {
      ...row,
      netEarningsCents: splitRevenue(row.revenueCents).netEarningsCents,
      sharePercent: share(row.revenueCents),
      averagePaidCents: Math.round(row.revenueCents / row.purchaseCount),
      discountPercent,
    };
  });

  return {
    revenueCents,
    netEarningsCents: splitRevenue(revenueCents).netEarningsCents,
    purchaseCount,
    discountedRevenueCents,
    discountedNetEarningsCents: splitRevenue(discountedRevenueCents)
      .netEarningsCents,
    discountedSharePercent: share(discountedRevenueCents),
    rows: breakdown,
  };
}
