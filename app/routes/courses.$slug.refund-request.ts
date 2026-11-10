import { data, redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/courses.$slug.refund-request";
import { getCurrentUserId } from "~/lib/session";
import { db } from "~/db";
import { courses, users } from "~/db/schema";
import { eq } from "drizzle-orm";
import { parseFormData, parseParams } from "~/lib/validation";
import { makeStudentRefundRequest } from "~/lib/refund-eligibility.server";
import {
  buildRefundRequestEmail,
  logEmail,
} from "~/lib/refund-request-emails.server";
import {
  refundRequestSchema,
  refusalStatus,
} from "~/lib/refund-request-action.server";

const refundRequestParamsSchema = z.object({
  slug: z.string().min(1),
});

function getCourseBySlug(slug: string) {
  return db.select().from(courses).where(eq(courses.slug, slug)).get();
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

  const formData = await request.formData();
  const parsed = parseFormData(formData, refundRequestSchema);

  if (!parsed.success) {
    return data({ errors: parsed.errors }, { status: 400 });
  }

  // The action enforces exactly the Refund Eligibility the course page offers,
  // rechecked in the same transaction that records the request.
  const made = makeStudentRefundRequest(db, {
    userId: currentUserId,
    courseId: course.id,
    reason: parsed.data.reason,
  });

  if (!made.ok) {
    throw data(made.error, { status: refusalStatus[made.code] });
  }

  const email = buildRefundRequestEmail({
    studentName: student.name,
    studentEmail: student.email,
    courseTitle: course.title,
    refundAmount: made.amount,
  });

  logEmail(email);

  return redirect("/settings");
}
