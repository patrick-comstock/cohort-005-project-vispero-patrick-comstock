import { beforeEach, describe, expect, it } from "vitest";

import * as schema from "~/db/schema";
import { CourseStatus, RefundRequestStatus, UserRole } from "~/db/schema";
import { ANALYTICS_RANGES } from "~/lib/analytics";
import { makeRefundRequest } from "~/lib/refund-eligibility.server";
import { resolveRefundRequest } from "~/lib/refund-request-resolve.server";
import { createTestDb, seedBaseData } from "~/test/setup";

import {
  type AnalyticsParams,
  type AnalyticsViewer,
  loadAnalyticsPage,
  parseAnalyticsParams,
} from "../index.server";

type TestDb = ReturnType<typeof createTestDb>;

// Midday UTC, well away from either edge of the day the Refund Window counts.
const now = new Date("2026-03-15T12:00:00.000Z");

let testDb: TestDb;
let base: ReturnType<typeof seedBaseData>;
let admin: typeof schema.users.$inferSelect;
let instructor: AnalyticsViewer;
let adminViewer: AnalyticsViewer;

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
  instructor = { userId: base.instructor.id, isAdmin: false };
  adminViewer = { userId: admin.id, isAdmin: true };
});

function params(overrides: Partial<AnalyticsParams> = {}): AnalyticsParams {
  return {
    tab: "overview",
    range: "all",
    instructorId: null,
    courseId: null,
    ...overrides,
  };
}

function load(viewer: AnalyticsViewer, overrides: Partial<AnalyticsParams>) {
  return loadAnalyticsPage(viewer, params(overrides), now, testDb);
}

/** A Purchase made at midday UTC on `day`. */
function buy(
  day: string,
  amountPaid: number,
  courseId: number = base.course.id
) {
  return testDb
    .insert(schema.purchases)
    .values({
      userId: base.user.id,
      courseId,
      amountPaid,
      country: "US",
      createdAt: `${day}T12:00:00.000Z`,
    })
    .returning()
    .get();
}

function requestRefund(
  purchaseId: number,
  status: RefundRequestStatus = RefundRequestStatus.Pending
) {
  const made = makeRefundRequest(testDb, {
    purchaseId,
    reason: "The course was not what I expected.",
  });
  if (!made.ok) throw new Error(made.error);
  if (status === RefundRequestStatus.Pending) return;
  const resolved = resolveRefundRequest(testDb, {
    refundRequestId: made.refundRequest.id,
    adminUserId: admin.id,
    resolution: status,
    resolutionNote: "Noted.",
  });
  if (!resolved.ok) throw new Error(resolved.error);
}

function addInstructor(name: string) {
  return testDb
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
      role: UserRole.Instructor,
    })
    .returning()
    .get();
}

function addCourse(
  title: string,
  instructorId: number = base.instructor.id,
  status: CourseStatus = CourseStatus.Published
) {
  return testDb
    .insert(schema.courses)
    .values({
      title,
      slug: title.toLowerCase().replace(/\s+/g, "-"),
      description: title,
      salesCopy: title,
      instructorId,
      categoryId: base.category.id,
      status,
    })
    .returning()
    .get();
}

describe("loadAnalyticsPage: Refund exposure", () => {
  it("counts only Purchases inside their Refund Window with no Resolved Refund Request", () => {
    buy("2026-03-10", 1000); // inside the window, 9 days left
    buy("2026-02-01", 2000); // window closed on 02-15
    buy("2026-03-01", 3000); // window closes today
    buy("2026-03-20", 4000); // dated after today, so not in its window yet
    requestRefund(buy("2026-03-10", 5000).id, RefundRequestStatus.Approved);
    requestRefund(buy("2026-03-10", 6000).id, RefundRequestStatus.Declined);
    requestRefund(buy("2026-03-12", 7000).id, RefundRequestStatus.Pending);

    const page = load(instructor, {});

    // Everything but the Refunded Purchase is Revenue.
    expect(page.summary.revenueCents).toBe(23000);
    expect(page.refundExposure).toEqual({
      revenueCents: 11000,
      netEarningsCents: 8800,
      purchaseCount: 3,
      sharePercent: 48,
      closingTodayCount: 1,
      courses: [
        {
          courseId: base.course.id,
          title: "Test Course",
          revenueCents: 11000,
          purchaseCount: 3,
          daysLeft: 0,
        },
      ],
    });
  });

  it("counts the days left to the last day of the window", () => {
    buy("2026-03-10", 1000);
    expect(load(instructor, {}).refundExposure).toMatchObject({
      closingTodayCount: 0,
      courses: [{ daysLeft: 9 }],
    });
  });

  it("groups by course, biggest first, headed by each course's most urgent Purchase", () => {
    const big = addCourse("Big Course");
    buy("2026-03-10", 1000);
    buy("2026-03-14", 20000, big.id);
    buy("2026-03-05", 500, big.id);

    expect(load(instructor, {}).refundExposure.courses).toEqual([
      {
        courseId: big.id,
        title: "Big Course",
        revenueCents: 20500,
        purchaseCount: 2,
        daysLeft: 4,
      },
      {
        courseId: base.course.id,
        title: "Test Course",
        revenueCents: 1000,
        purchaseCount: 1,
        daysLeft: 9,
      },
    ]);
  });

  it("is all zeros when nothing could still be Refunded", () => {
    buy("2026-02-01", 2000);

    expect(load(instructor, {}).refundExposure).toEqual({
      revenueCents: 0,
      netEarningsCents: 0,
      purchaseCount: 0,
      sharePercent: 0,
      closingTodayCount: 0,
      courses: [],
    });
  });
});

describe("loadAnalyticsPage: scoping", () => {
  let other: typeof schema.users.$inferSelect;
  let otherCourse: typeof schema.courses.$inferSelect;

  beforeEach(() => {
    other = addInstructor("Olive Other");
    otherCourse = addCourse("Other Course", other.id);
    buy("2026-03-10", 1000);
    buy("2026-03-10", 9000, otherCourse.id);
  });

  it("pins an Instructor to their own figures, whoever they ask for", () => {
    const page = load(instructor, { instructorId: other.id });

    expect(page.instructorId).toBe(base.instructor.id);
    expect(page.isAdmin).toBe(false);
    expect(page.summary.revenueCents).toBe(1000);
    expect(page.refundExposure.revenueCents).toBe(1000);
    expect(page.courseOptions).toEqual([
      { courseId: base.course.id, title: "Test Course" },
    ]);
    expect(page.instructors).toEqual([]);
  });

  it("opens an Instructor's own course but not another instructor's", () => {
    const own = load(instructor, { tab: "course", courseId: base.course.id });
    expect(own.selectedCourseId).toBe(base.course.id);
    expect(own.countries).toMatchObject({ revenueCents: 1000 });

    const theirs = load(instructor, {
      tab: "course",
      courseId: otherCourse.id,
    });
    expect(theirs.selectedCourseId).toBeNull();
    expect(theirs.progress).toBeNull();
    expect(theirs.funnel).toBeNull();
    expect(theirs.quizzes).toBeNull();
    expect(theirs.countries).toBeNull();
  });

  it("shows an Admin with no instructor picked the whole platform", () => {
    const page = load(adminViewer, {});

    expect(page.instructorId).toBeNull();
    expect(page.summary.revenueCents).toBe(10000);
    expect(page.refundExposure.revenueCents).toBe(10000);
    expect(page.instructors).toEqual([
      { id: other.id, name: "Olive Other" },
      { id: base.instructor.id, name: "Test Instructor" },
    ]);
    expect(page.unpublished).toBe(false);
  });

  it("shows an Admin only the instructor they picked", () => {
    const page = load(adminViewer, {
      instructorId: other.id,
      courseId: otherCourse.id,
    });

    expect(page.instructorId).toBe(other.id);
    expect(page.summary.revenueCents).toBe(9000);
    expect(page.courseOptions).toEqual([
      { courseId: otherCourse.id, title: "Other Course" },
    ]);
    expect(page.selectedCourseId).toBe(otherCourse.id);
  });

  it("marks an instructor with only draft courses as unpublished", () => {
    const drafter = addInstructor("Dana Draft");
    addCourse("Draft Course", drafter.id, CourseStatus.Draft);

    expect(load({ userId: drafter.id, isAdmin: false }, {}).unpublished).toBe(
      true
    );
    expect(load(instructor, {}).unpublished).toBe(false);
  });
});

describe("loadAnalyticsPage: range", () => {
  it("counts only Purchases since the start of the range ending at now", () => {
    buy("2026-03-12", 1000); // 3 days old
    buy("2026-01-14", 2000); // 60 days old

    expect(load(instructor, { range: "30d" }).summary.revenueCents).toBe(1000);
    expect(load(instructor, { range: "all" }).summary.revenueCents).toBe(3000);
  });

  it("leaves a Purchase still in its Refund Window out of exposure when it is before the range", () => {
    buy("2026-03-12", 1000); // 3 days old
    buy("2026-03-05", 4000); // 10 days old, still in its Refund Window

    expect(load(instructor, { range: "7d" }).refundExposure).toMatchObject({
      revenueCents: 1000,
      purchaseCount: 1,
    });
    expect(load(instructor, { range: "30d" }).refundExposure).toMatchObject({
      revenueCents: 5000,
      purchaseCount: 2,
    });
  });

  it("charts every day from the start of the range to today", () => {
    buy("2026-03-12", 1000);

    const { series } = load(instructor, { range: "30d" });
    const buckets = series.points.map((point) => point.bucket);

    expect(series.granularity).toBe("day");
    // From the day the range starts on (02-13 12:00) to today, both included.
    expect(buckets[0]).toBe("2026-02-13");
    expect(buckets.at(-1)).toBe("2026-03-15");
    expect(buckets).toHaveLength(31);
    expect(
      series.points.find((point) => point.bucket === "2026-03-12")
    ).toMatchObject({ revenueCents: 1000, netEarningsCents: 800 });
  });
});

describe("parseAnalyticsParams", () => {
  const parse = (query: string) =>
    parseAnalyticsParams(new URLSearchParams(query));

  it("reads a valid view", () => {
    expect(parse("tab=course&range=7d&instructor=4&course=12")).toEqual({
      tab: "course",
      range: "7d",
      instructorId: 4,
      courseId: 12,
    });
  });

  it("accepts every range the control offers", () => {
    for (const { value } of ANALYTICS_RANGES) {
      expect(parse(`range=${value}`).range).toBe(value);
    }
  });

  it("falls back to the default view when params are missing", () => {
    expect(parse("")).toEqual({
      tab: "overview",
      range: "30d",
      instructorId: null,
      courseId: null,
    });
  });

  it("falls back to the default for junk, and gives no id for anything but a positive integer", () => {
    expect(
      parse("tab=settings&range=last+tuesday&instructor=abc&course=-3")
    ).toEqual({
      tab: "overview",
      range: "30d",
      instructorId: null,
      courseId: null,
    });
    expect(parse("instructor=1.5&course=0")).toMatchObject({
      instructorId: null,
      courseId: null,
    });
    expect(parse("instructor=&course=")).toMatchObject({
      instructorId: null,
      courseId: null,
    });
  });
});
