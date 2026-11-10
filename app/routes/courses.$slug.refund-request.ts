import { data, redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/courses.$slug.refund-request";
import { getCurrentUserId } from "~/lib/session";
import { db } from "~/db";
import {
  courses,
  lessons,
  modules,
  users,
  videoWatchEvents,
} from "~/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { parseFormData, parseParams } from "~/lib/validation";
import { formatPrice } from "~/lib/utils";
import {
  REFUND_WINDOW_DAYS,
  WATCH_TIME_LIMIT_SECONDS,
  getRefundRequestPurchase,
  hasRefundRequest,
  lastDayOfRefundWindow,
  makeRefundRequest,
  toCalendarDay,
} from "~/lib/refund-requests.server";

const refundRequestParamsSchema = z.object({
  slug: z.string().min(1),
});

const refundRequestSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, "Tell us a little more about why you want a refund.")
    .max(1000, "Please keep your reason under 1000 characters."),
});

function getCourseBySlug(slug: string) {
  return db.select().from(courses).where(eq(courses.slug, slug)).get();
}

function getLessonIdsForCourse(courseId: number): number[] {
  const rows = db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .all();

  return rows.map((row) => row.id);
}

/**
 * The confirmation the Student gets in their inbox. There is no mail
 * transport wired up yet, so the built message goes to the server log.
 */
function buildRefundRequestEmail(input: {
  studentName: string;
  studentEmail: string;
  courseTitle: string;
  refundAmount: number;
}) {
  return {
    to: input.studentEmail,
    subject: `Refund Request received — ${input.courseTitle}`,
    body: [
      `Hi ${input.studentName},`,
      "",
      `We have your Refund Request for "${input.courseTitle}".`,
      `If it is approved, your Refund will be ${formatPrice(input.refundAmount)}, the amount you paid.`,
      "",
      "Our team reviews every Refund Request by hand. You do not need to do anything else — we will email you again when it is resolved.",
      "",
      "— The Cadence team",
    ].join("\n"),
  };
}

export async function action({ params, request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("You must be logged in to request a refund.", { status: 401 });
  }

  const { slug } = parseParams(params, refundRequestParamsSchema);
  const course = getCourseBySlug(slug);

  if (!course) {
    throw data("Course not found", { status: 404 });
  }

  const student = db
    .select()
    .from(users)
    .where(eq(users.id, currentUserId))
    .get();

  if (!student) {
    throw data("User not found", { status: 404 });
  }

  const purchase = getRefundRequestPurchase(db, currentUserId, course.id);

  if (!purchase) {
    throw data("You have not bought this course.", { status: 403 });
  }

  // A Purchase can have at most one Refund Request, ever — Pending or Resolved.
  if (hasRefundRequest(db, purchase.id)) {
    throw data("You have already made a Refund Request for this Purchase.", {
      status: 409,
    });
  }

  const today = toCalendarDay(new Date());
  const withinRefundWindow = today <= lastDayOfRefundWindow(purchase.createdAt);

  if (!withinRefundWindow) {
    throw data(`The ${REFUND_WINDOW_DAYS}-day Refund Window has closed.`, {
      status: 403,
    });
  }

  const courseLessonIds = getLessonIdsForCourse(course.id);

  let watchedSeconds = 0;
  if (courseLessonIds.length > 0) {
    const furthestPerLesson = db
      .select({
        furthest: sql<number>`max(${videoWatchEvents.positionSeconds})`,
      })
      .from(videoWatchEvents)
      .where(
        and(
          eq(videoWatchEvents.userId, currentUserId),
          inArray(videoWatchEvents.lessonId, courseLessonIds)
        )
      )
      .groupBy(videoWatchEvents.lessonId)
      .all();

    watchedSeconds = furthestPerLesson.reduce(
      (total, row) => total + row.furthest,
      0
    );
  }

  if (watchedSeconds >= WATCH_TIME_LIMIT_SECONDS) {
    throw data(
      "You have watched too much of this course to request a refund.",
      { status: 403 }
    );
  }

  // The Refund is always the full amount paid for the Purchase.
  const refundableAmount = purchase.amountPaid;

  const formData = await request.formData();
  const parsed = parseFormData(formData, refundRequestSchema);

  if (!parsed.success) {
    return data({ errors: parsed.errors }, { status: 400 });
  }

  const made = makeRefundRequest(db, {
    purchaseId: purchase.id,
    reason: parsed.data.reason,
  });

  if (!made.ok) {
    throw data(made.error, { status: 409 });
  }

  const email = buildRefundRequestEmail({
    studentName: student.name,
    studentEmail: student.email,
    courseTitle: course.title,
    refundAmount: refundableAmount,
  });

  console.log(
    `[email] to=${email.to} subject=${email.subject}\n${email.body}`
  );

  return redirect("/settings");
}
