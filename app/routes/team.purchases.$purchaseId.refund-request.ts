import { data, redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/team.purchases.$purchaseId.refund-request";
import { getCurrentUserId } from "~/lib/session";
import { db } from "~/db";
import { courses, purchases, users } from "~/db/schema";
import { eq } from "drizzle-orm";
import { parseFormData, parseParams } from "~/lib/validation";
import { formatPrice } from "~/lib/utils";
import {
  makeTeamPurchaseRefundRequest,
  type TeamPurchaseRefundRequestRefusalCode,
} from "~/lib/refund-requests.server";

const paramsSchema = z.object({
  purchaseId: z.coerce.number().int().positive(),
});

const refundRequestSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, "Tell us a little more about why you want a refund.")
    .max(1000, "Please keep your reason under 1000 characters."),
});

const refusalStatus: Record<TeamPurchaseRefundRequestRefusalCode, number> = {
  "not-found": 404,
  "not-buyer": 403,
  "not-team-purchase": 400,
  "already-requested": 409,
  "outside-refund-window": 403,
  "coupon-redeemed": 403,
};

/**
 * The confirmation the Team Purchase buyer gets in their inbox. There is no
 * mail transport wired up yet, so the built message goes to the server log.
 */
function buildTeamPurchaseRefundRequestEmail(input: {
  buyerName: string;
  buyerEmail: string;
  courseTitle: string;
  refundAmount: number;
}) {
  return {
    to: input.buyerEmail,
    subject: `Refund Request received — ${input.courseTitle} (Team Purchase)`,
    body: [
      `Hi ${input.buyerName},`,
      "",
      `We have your Refund Request for your Team Purchase of "${input.courseTitle}".`,
      `If it is approved, your Refund will be ${formatPrice(input.refundAmount)}, the amount you paid, and all of its Coupons will be Voided.`,
      "",
      "While we review it, its Coupons can't be Redeemed. We will email you again when it is resolved.",
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

  const { purchaseId } = parseParams(params, paramsSchema);

  const buyer = db
    .select()
    .from(users)
    .where(eq(users.id, currentUserId))
    .get();

  if (!buyer) {
    throw data("User not found", { status: 404 });
  }

  const formData = await request.formData();
  const parsed = parseFormData(formData, refundRequestSchema);

  if (!parsed.success) {
    return data({ errors: parsed.errors }, { status: 400 });
  }

  // The offer is rechecked in the same transaction that records the request.
  const made = makeTeamPurchaseRefundRequest(db, {
    userId: currentUserId,
    purchaseId,
    reason: parsed.data.reason,
  });

  if (!made.ok) {
    throw data(made.error, { status: refusalStatus[made.code] });
  }

  const course = db
    .select({ title: courses.title })
    .from(purchases)
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(eq(purchases.id, purchaseId))
    .get();

  const email = buildTeamPurchaseRefundRequestEmail({
    buyerName: buyer.name,
    buyerEmail: buyer.email,
    courseTitle: course?.title ?? "your course",
    refundAmount: made.amount,
  });

  console.log(`[email] to=${email.to} subject=${email.subject}\n${email.body}`);

  return redirect("/team");
}
