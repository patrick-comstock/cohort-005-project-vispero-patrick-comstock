import { and, count, eq, sql } from "drizzle-orm";

import { type Db, db } from "~/db";
import { courseRatings, courses, CourseStatus, users } from "~/db/schema";
import {
  type AnalyticsScope,
  ownedBy,
  scopeOn,
} from "~/lib/analytics-scope.server";
import {
  getBuyerCount,
  getCourseRevenueByCountry,
  getFullyRefundedCourseIds,
  getRevenueByCourse,
  getRevenueOverTime,
  getRevenueSummary,
  getStudentRevenue,
  getTopBuyers,
} from "~/lib/revenue.server";

import type { AnalyticsParams } from "./analytics-params";
import {
  getCourseDropOff,
  getCourseProgressSummary,
} from "./course-progress.server";
import { getCourseQuizPassRates } from "./quiz-pass-rates.server";
import { getRefundExposure } from "./refund-exposure.server";
import { getUnansweredQuestions } from "./unanswered-questions.server";

// ─── Instructor Analytics page ───
// Everything the analytics page shows, for one viewer at one moment. The route
// authenticates, parses the search params and passes `new Date()`; this module
// owns the rules: who may see whose figures, which course may be opened, and
// what counts as Refund exposure.

/** Who is looking: an Instructor sees only their own figures. */
export type AnalyticsViewer = { userId: number; isAdmin: boolean };

type RatingSummary = {
  average: number | null;
  count: number;
};

function getRatingSummary(
  database: Db,
  { instructorId, range, now }: AnalyticsScope
): RatingSummary {
  const row = database
    .select({
      average: sql<number | null>`avg(${courseRatings.rating})`,
      count: count(courseRatings.id),
    })
    .from(courseRatings)
    .innerJoin(courses, eq(courseRatings.courseId, courses.id))
    .where(scopeOn(courseRatings.createdAt, instructorId, range, now))
    .get();

  if (!row || row.count === 0 || row.average === null) {
    return { average: null, count: 0 };
  }

  return { average: Math.round(row.average * 10) / 10, count: row.count };
}

/**
 * Everything the Instructor Analytics page shows for one viewer, as of `now`.
 *
 * Instructors are pinned to their own figures whatever they ask for; only an
 * Admin may look at another instructor, and null means every instructor. A
 * requested course is opened only if it is one of the viewer's own.
 *
 * Reads the app's database unless given another one; tests pass their own.
 */
export function loadAnalyticsPage(
  viewer: AnalyticsViewer,
  params: AnalyticsParams,
  now: Date,
  database: Db = db
) {
  const { tab, range } = params;
  const instructorId = viewer.isAdmin ? params.instructorId : viewer.userId;

  // The selector lists every course the viewer owns rather than only the ones
  // that sold: a course nobody is finishing is exactly what this tab is for.
  const courseOptions = database
    .select({ courseId: courses.id, title: courses.title })
    .from(courses)
    .where(ownedBy(instructorId))
    .orderBy(courses.title)
    .all();

  // Checked against the list rather than trusted: the id arrives in the URL,
  // and an instructor may not read another instructor's funnel.
  const selectedCourseId = courseOptions.some(
    (course) => course.courseId === params.courseId
  )
    ? params.courseId
    : null;

  // Gross Sales, Refunds, Revenue, the platform's fee and Net Earnings for
  // the range. Every breakdown below is in Revenue, after Refunds.
  const scope: AnalyticsScope = { instructorId, range, now };
  const summary = getRevenueSummary(database, scope);

  // How many people paid, and how many are learning. Deliberately two numbers:
  // one team purchase is a single buyer covering several Coupons, and someone who
  // redeems a Coupon enrols without a purchase row of their own.
  const students = getStudentRevenue(database, scope);
  const attributedRevenue = students.reduce(
    (total, student) => total + student.revenueCents,
    0
  );

  const audience = {
    buyerCount: getBuyerCount(database, scope),
    studentCount: students.length,
    revenuePerStudentCents:
      students.length === 0
        ? null
        : Math.round(attributedRevenue / students.length),
  };

  // Everyone who owns at least one course, for the admin's instructor picker.
  // Owners rather than users with the instructor role: an admin who owns a
  // course contributes to the platform-wide total.
  const instructors = viewer.isAdmin
    ? database
        .selectDistinct({ id: users.id, name: users.name })
        .from(courses)
        .innerJoin(users, eq(courses.instructorId, users.id))
        .orderBy(users.name)
        .all()
    : [];

  // Drives the "publish your first course" empty state. The platform-wide view
  // always has courses in it, so the prompt only makes sense for one named
  // instructor.
  const publishedRow =
    instructorId === null
      ? undefined
      : database
          .select({ id: courses.id })
          .from(courses)
          .where(
            and(
              eq(courses.instructorId, instructorId),
              eq(courses.status, CourseStatus.Published)
            )
          )
          .get();

  return {
    questions: getUnansweredQuestions(database, scope),
    audience,
    buyers: getTopBuyers(database, scope),
    ratings: getRatingSummary(database, scope),
    tab,
    range,
    isAdmin: viewer.isAdmin,
    instructorId,
    selectedCourseId,
    summary,
    series: getRevenueOverTime(database, scope),
    // Revenue broken down by course, biggest earner first.
    courses: getRevenueByCourse(database, scope),
    // Courses left out of that breakdown because every sale was Refunded, so
    // the table can say so rather than claim there were no sales.
    fullyRefundedCourseIds: getFullyRefundedCourseIds(database, scope),
    courseOptions,
    // Progress and drop-off carry no usable timestamp, so they span all time
    // whatever the range control says — and the tab says so on screen.
    progress:
      selectedCourseId === null
        ? null
        : getCourseProgressSummary(database, selectedCourseId),
    funnel:
      selectedCourseId === null
        ? null
        : getCourseDropOff(database, selectedCourseId),
    // Quiz attempts and purchases are both timestamped, so unlike the two
    // panels above these do honour the range control.
    quizzes:
      selectedCourseId === null
        ? null
        : getCourseQuizPassRates(database, selectedCourseId, range, now),
    countries:
      selectedCourseId === null
        ? null
        : getCourseRevenueByCountry(database, selectedCourseId, range, now),
    instructors,
    refundExposure: getRefundExposure(database, scope, summary.revenueCents),
    unpublished: instructorId !== null && publishedRow === undefined,
  };
}

export type AnalyticsPage = ReturnType<typeof loadAnalyticsPage>;
