import { data, redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/courses.$slug.refund-request";
import { getCurrentUserId } from "~/lib/session";
import { db } from "~/db";
import { courses, users } from "~/db/schema";
import { eq } from "drizzle-orm";
import { parseFormData, parseParams } from "~/lib/validation";
import { formatPrice } from "~/lib/utils";
import {
  getRefundRequestOffer,
  makeRefundRequest,
  type RefundRequestRefusalCode,
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

const refusalStatus: Record<RefundRequestRefusalCode, number> = {
  "not-enrolled": 403,
  "joined-with-coupon": 403,
  "no-purchase": 403,
  "already-requested": 409,
  "outside-refund-window": 403,
  "completion-limit": 403,
  "watch-time-limit": 403,
};

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

  // The action enforces exactly the Refund Eligibility the course page offers.
  const offer = getRefundRequestOffer(db, {
    userId: currentUserId,
    courseId: course.id,
  });

  if (!offer.ok) {
    throw data(offer.error, { status: refusalStatus[offer.code] });
  }

  const formData = await request.formData();
  const parsed = parseFormData(formData, refundRequestSchema);

  if (!parsed.success) {
    return data({ errors: parsed.errors }, { status: 400 });
  }

  const made = makeRefundRequest(db, {
    purchaseId: offer.purchase.id,
    reason: parsed.data.reason,
  });

  if (!made.ok) {
    throw data(made.error, { status: 409 });
  }

  const email = buildRefundRequestEmail({
    studentName: student.name,
    studentEmail: student.email,
    courseTitle: course.title,
    refundAmount: offer.amount,
  });

  console.log(`[email] to=${email.to} subject=${email.subject}\n${email.body}`);

  return redirect("/settings");
}
