import {
  and,
  count,
  countDistinct,
  eq,
  inArray,
  isNull,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { z } from "zod";

import { type Db, db } from "~/db";
import {
  comments,
  courseRatings,
  courses,
  CourseStatus,
  enrollments,
  lessonProgress,
  LessonProgressStatus,
  lessons,
  modules,
  purchases,
  quizAttempts,
  quizzes,
  refundRequests,
  UserRole,
  users,
} from "~/db/schema";
import {
  ANALYTICS_RANGE_VALUES,
  type AnalyticsRange,
  DEFAULT_ANALYTICS_RANGE,
  rangeStart,
  splitRevenue,
} from "~/lib/analytics";
import {
  type AnalyticsScope,
  ownedBy,
  scopeOn,
  sinceRange,
} from "~/lib/analytics-scope.server";
import {
  daysLeftInRefundWindow,
  isWithinRefundWindow,
} from "~/lib/refund-window";
import {
  getBuyerCount,
  getCourseRevenueByCountry,
  getFullyRefundedCourseIds,
  getRevenueByCourse,
  getRevenueOverTime,
  getRevenueSummary,
  getStudentRevenue,
  getTopBuyers,
  resolvedRefundRequest,
} from "~/lib/revenue.server";

// ─── Instructor Analytics page ───
// Everything the analytics page shows, for one viewer at one moment. The route
// authenticates, parses the search params and passes `new Date()`; this module
// owns the rules: who may see whose figures, which course may be opened, and
// what counts as Refund exposure.

/** Who is looking: an Instructor sees only their own figures. */
export type AnalyticsViewer = { userId: number; isAdmin: boolean };

export type AnalyticsTab = "overview" | "course";

export type AnalyticsParams = {
  tab: AnalyticsTab;
  range: AnalyticsRange;
  /** Requested; ignored unless the viewer is an Admin. Null means everyone. */
  instructorId: number | null;
  /** Requested; ignored unless it is one of the viewer's course options. */
  courseId: number | null;
};

/** A search param that should be a row id, or null if it isn't one. */
const idParam = z.coerce.number().int().positive().nullable().catch(null);

const analyticsParamsSchema = z.object({
  // "course" is the second tab; anything else falls back to the overview.
  tab: z.enum(["overview", "course"]).catch("overview"),
  range: z.enum(ANALYTICS_RANGE_VALUES).catch(DEFAULT_ANALYTICS_RANGE),
  instructor: idParam,
  course: idParam,
});

/**
 * Reads the page state from untrusted search params. Never fails: anything
 * unusable falls back to the default view.
 */
export function parseAnalyticsParams(
  searchParams: URLSearchParams
): AnalyticsParams {
  // A missing param is null; an empty one is no id either.
  const read = (key: string) => searchParams.get(key) || null;
  const parsed = analyticsParamsSchema.parse({
    tab: read("tab"),
    range: read("range"),
    instructor: read("instructor"),
    course: read("course"),
  });
  return {
    tab: parsed.tab,
    range: parsed.range,
    instructorId: parsed.instructor,
    courseId: parsed.course,
  };
}

type RatingSummary = {
  average: number | null;
  count: number;
};

export type CourseProgressSummary = {
  enrolledCount: number;
  totalLessons: number;
  averageProgressPercent: number | null;
  finishedCount: number;
};

export type FunnelLesson = {
  lessonId: number;
  title: string;
  reachedCount: number;
  dropFromPrevious: number;
};

type FunnelModule = {
  moduleId: number;
  title: string;
  reachedCount: number;
  dropWithin: number;
  lessons: FunnelLesson[];
};

export type CourseFunnel = {
  enrolledCount: number;
  modules: FunnelModule[];
};

export type QuizPassRate = {
  quizId: number;
  title: string;
  moduleTitle: string;
  lessonTitle: string;
  passingScorePercent: number;
  studentCount: number;
  passedCount: number;
  passRatePercent: number | null;
  averageBestScorePercent: number | null;
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

function courseLessonIds(database: Db, courseId: number) {
  return database
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId));
}

function getCourseProgressSummary(
  database: Db,
  courseId: number
): CourseProgressSummary {
  const totals = database
    .select({ totalLessons: count(lessons.id) })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .get();

  const totalLessons = totals?.totalLessons ?? 0;

  // One grouped row per enrollee, including the ones who never started: a
  // student who bought and vanished is the finding, so a left join keeps them.
  const perStudent = database
    .select({
      userId: enrollments.userId,
      completed: countDistinct(lessonProgress.lessonId),
    })
    .from(enrollments)
    .leftJoin(
      lessonProgress,
      and(
        eq(lessonProgress.userId, enrollments.userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        inArray(lessonProgress.lessonId, courseLessonIds(database, courseId))
      )
    )
    .where(eq(enrollments.courseId, courseId))
    .groupBy(enrollments.userId)
    .all();

  if (perStudent.length === 0 || totalLessons === 0) {
    return {
      enrolledCount: perStudent.length,
      totalLessons,
      averageProgressPercent: null,
      finishedCount: 0,
    };
  }

  const totalPercent = perStudent.reduce(
    (running, student) => running + (student.completed / totalLessons) * 100,
    0
  );

  return {
    enrolledCount: perStudent.length,
    totalLessons,
    averageProgressPercent: Math.round(totalPercent / perStudent.length),
    finishedCount: perStudent.filter(
      (student) => student.completed >= totalLessons
    ).length,
  };
}

/** A lesson a student has opened counts as reached; one they haven't doesn't. */
const REACHED_STATUSES = [
  LessonProgressStatus.InProgress,
  LessonProgressStatus.Completed,
];

function getCourseDropOff(database: Db, courseId: number): CourseFunnel {
  const enrolled = database
    .select({ enrolledCount: countDistinct(enrollments.userId) })
    .from(enrollments)
    .where(eq(enrollments.courseId, courseId))
    .get();

  const enrolledCount = enrolled?.enrolledCount ?? 0;

  const curriculum = database
    .select({
      moduleId: modules.id,
      moduleTitle: modules.title,
      lessonId: lessons.id,
      lessonTitle: lessons.title,
    })
    .from(modules)
    .innerJoin(lessons, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .orderBy(modules.position, lessons.position)
    .all();

  if (curriculum.length === 0) return { enrolledCount, modules: [] };

  const positionOf = new Map(
    curriculum.map((row, position) => [row.lessonId, position])
  );

  // Enrolment is joined rather than filtered afterwards, so somebody working
  // through a course they never enrolled in cannot inflate a bar past the
  // denominator underneath it.
  const touched = database
    .selectDistinct({
      userId: lessonProgress.userId,
      lessonId: lessonProgress.lessonId,
    })
    .from(lessonProgress)
    .innerJoin(
      enrollments,
      and(
        eq(enrollments.userId, lessonProgress.userId),
        eq(enrollments.courseId, courseId)
      )
    )
    .where(
      and(
        inArray(lessonProgress.lessonId, courseLessonIds(database, courseId)),
        inArray(lessonProgress.status, REACHED_STATUSES)
      )
    )
    .all();

  const furthest = new Map<number, number>();
  for (const row of touched) {
    const position = positionOf.get(row.lessonId);
    if (position === undefined) continue;
    furthest.set(
      row.userId,
      Math.max(furthest.get(row.userId) ?? -1, position)
    );
  }

  // Counted backwards from the end: everyone who stopped at a later lesson
  // passed through this one, which is the whole definition of the bar.
  const stoppedAt = curriculum.map(() => 0);
  for (const position of furthest.values()) stoppedAt[position] += 1;

  const reachedAt: number[] = [];
  let running = 0;
  for (let position = curriculum.length - 1; position >= 0; position--) {
    running += stoppedAt[position];
    reachedAt[position] = running;
  }

  const grouped: FunnelModule[] = [];
  let previousReached = enrolledCount;

  curriculum.forEach((row, position) => {
    const reachedCount = reachedAt[position];
    const lesson: FunnelLesson = {
      lessonId: row.lessonId,
      title: row.lessonTitle,
      reachedCount,
      dropFromPrevious: previousReached - reachedCount,
    };
    previousReached = reachedCount;

    const current = grouped.at(-1);
    if (current?.moduleId === row.moduleId) {
      current.lessons.push(lesson);
      current.dropWithin = current.reachedCount - reachedCount;
    } else {
      grouped.push({
        moduleId: row.moduleId,
        title: row.moduleTitle,
        reachedCount,
        dropWithin: 0,
        lessons: [lesson],
      });
    }
  });

  return { enrolledCount, modules: grouped };
}

function getCourseQuizPassRates(
  database: Db,
  courseId: number,
  range: AnalyticsRange,
  now: Date
): QuizPassRate[] {
  const quizRows = database
    .select({
      quizId: quizzes.id,
      title: quizzes.title,
      passingScore: quizzes.passingScore,
      moduleTitle: modules.title,
      lessonTitle: lessons.title,
    })
    .from(quizzes)
    .innerJoin(lessons, eq(quizzes.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .orderBy(modules.position, lessons.position, quizzes.id)
    .all();

  if (quizRows.length === 0) return [];

  const quizIds = quizRows.map((quiz) => quiz.quizId);

  // One row per student per quiz, holding the best they managed.
  //
  // `passed` and `score` are selected bare beside `max(score)`: SQLite answers
  // those from the very row the maximum came from, which is how the best
  // attempt's own recorded verdict is read rather than a fresh comparison.
  const bestAttempts = database
    .select({
      quizId: quizAttempts.quizId,
      bestScore: sql<number>`max(${quizAttempts.score})`.as("best_score"),
      passed: sql<number>`${quizAttempts.passed}`.as("best_passed"),
    })
    .from(quizAttempts)
    .where(
      and(
        inArray(quizAttempts.quizId, quizIds),
        sinceRange(quizAttempts.attemptedAt, range, now)
      )
    )
    .groupBy(quizAttempts.quizId, quizAttempts.userId)
    .as("best_attempts");

  const stats = database
    .select({
      quizId: bestAttempts.quizId,
      studentCount: count(),
      passedCount: sql<number>`sum(${bestAttempts.passed})`,
      averageBestScore: sql<number>`avg(${bestAttempts.bestScore})`,
    })
    .from(bestAttempts)
    .groupBy(bestAttempts.quizId)
    .all();

  const statsByQuiz = new Map(stats.map((row) => [row.quizId, row]));

  return quizRows.map((quiz) => {
    const row = statsByQuiz.get(quiz.quizId);
    const studentCount = row?.studentCount ?? 0;
    const passedCount = Number(row?.passedCount ?? 0);

    return {
      quizId: quiz.quizId,
      title: quiz.title,
      moduleTitle: quiz.moduleTitle,
      lessonTitle: quiz.lessonTitle,
      passingScorePercent: Math.round(quiz.passingScore * 100),
      studentCount,
      passedCount,
      passRatePercent:
        studentCount === 0
          ? null
          : Math.round((passedCount / studentCount) * 100),
      averageBestScorePercent:
        studentCount === 0
          ? null
          : Math.round(Number(row?.averageBestScore ?? 0) * 100),
    };
  });
}

/**
 * Unanswered questions. A question qualifies when it is top-level, not
 * deleted, not written by staff, and has no reply from the course's
 * instructor or an admin. Split rather than filtered by the range: questions
 * older than it are still reported, because months of silence is the urgent
 * case.
 */
function getUnansweredQuestions(
  database: Db,
  { instructorId, range, now }: AnalyticsScope
) {
  const questionsSince = rangeStart(range, now);
  const questionAuthor = alias(users, "author");
  const reply = alias(comments, "reply");
  const replyAuthor = alias(users, "reply_author");

  // Correlated: matches a live reply, by staff, to the outer question.
  const staffReply = database
    .select({ one: sql`1` })
    .from(reply)
    .innerJoin(replyAuthor, eq(replyAuthor.id, reply.userId))
    .where(
      and(
        eq(reply.parentId, comments.id),
        isNull(reply.deletedAt),
        or(
          eq(replyAuthor.role, UserRole.Admin),
          eq(reply.userId, courses.instructorId)
        )
      )
    );

  const questionConditions = [
    isNull(comments.parentId),
    isNull(comments.deletedAt),
    // Staff asking their own question shouldn't queue up as work for themselves.
    ne(questionAuthor.role, UserRole.Admin),
    ne(comments.userId, courses.instructorId),
    notExists(staffReply),
  ];

  if (instructorId !== null) {
    questionConditions.push(eq(courses.instructorId, instructorId));
  }

  const questionRow = database
    .select({
      inRange:
        questionsSince === null
          ? count(comments.id)
          : sql<number>`sum(case when ${comments.createdAt} >= ${questionsSince} then 1 else 0 end)`,
      total: count(comments.id),
    })
    .from(comments)
    .innerJoin(questionAuthor, eq(comments.userId, questionAuthor.id))
    .innerJoin(lessons, eq(comments.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(and(...questionConditions))
    .get();

  // sum() is null over an empty set; count() is already 0.
  const questionsInRange = Number(questionRow?.inRange ?? 0);
  return {
    inRange: questionsInRange,
    older: (questionRow?.total ?? 0) - questionsInRange,
  };
}

// ─── Refund exposure ───
// Revenue is reported the moment a Purchase lands, but a Refund Request can be
// made for fourteen days, so some of what this page calls Revenue is still the
// learner's money. This panel says how much of it is. Purchases already
// Refunded are out of Revenue, so they are not exposed either. Nor are
// Purchases whose Refund Request was Declined: a Resolution is final and a
// Purchase has at most one Refund Request, so that money is kept. A Pending
// Refund Request still counts as exposed. The Refund Window is judged exactly
// as Refund Eligibility judges it, so a Purchase dated after today is not
// exposed either.

type ExposedCourse = {
  courseId: number;
  title: string;
  revenueCents: number;
  purchaseCount: number;
  /** Days left for its most urgent Purchase; 0 means the window closes today. */
  daysLeft: number;
};

export type RefundExposure = {
  revenueCents: number;
  netEarningsCents: number;
  purchaseCount: number;
  /** Exposed Revenue as a share of the period's Revenue. */
  sharePercent: number;
  closingTodayCount: number;
  courses: ExposedCourse[];
};

function getRefundExposure(
  database: Db,
  scope: AnalyticsScope,
  revenueCents: number
): RefundExposure {
  // Every Purchase in the range with no Resolved Refund Request (none, or one
  // still Pending), then the ones inside their Refund Window, grouped up.
  const rows = database
    .select({
      courseId: courses.id,
      title: courses.title,
      amountPaid: purchases.amountPaid,
      createdAt: purchases.createdAt,
    })
    .from(purchases)
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .leftJoin(refundRequests, resolvedRefundRequest)
    .where(
      and(
        scopeOn(
          purchases.createdAt,
          scope.instructorId,
          scope.range,
          scope.now
        ),
        isNull(refundRequests.id)
      )
    )
    .all();

  const exposedByCourse = new Map<number, ExposedCourse>();
  let exposedRevenueCents = 0;
  let exposedPurchaseCount = 0;
  let closingTodayCount = 0;

  for (const row of rows) {
    if (!isWithinRefundWindow(row.createdAt, scope.now)) continue;
    const daysLeft = daysLeftInRefundWindow(row.createdAt, scope.now);

    // Not Refunded, so all of what was paid is still in Revenue.
    exposedRevenueCents += row.amountPaid;
    exposedPurchaseCount += 1;
    if (daysLeft === 0) closingTodayCount += 1;

    const existing = exposedByCourse.get(row.courseId);

    if (existing === undefined) {
      exposedByCourse.set(row.courseId, {
        courseId: row.courseId,
        title: row.title,
        revenueCents: row.amountPaid,
        purchaseCount: 1,
        daysLeft,
      });
    } else {
      existing.revenueCents += row.amountPaid;
      existing.purchaseCount += 1;
      // The course's headline is its most urgent purchase, not its newest.
      existing.daysLeft = Math.min(existing.daysLeft, daysLeft);
    }
  }

  return {
    revenueCents: exposedRevenueCents,
    netEarningsCents: splitRevenue(exposedRevenueCents).netEarningsCents,
    purchaseCount: exposedPurchaseCount,
    sharePercent:
      revenueCents === 0
        ? 0
        : Math.round((exposedRevenueCents / revenueCents) * 100),
    closingTodayCount,
    courses: [...exposedByCourse.values()].sort(
      (a, b) => b.revenueCents - a.revenueCents
    ),
  };
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
