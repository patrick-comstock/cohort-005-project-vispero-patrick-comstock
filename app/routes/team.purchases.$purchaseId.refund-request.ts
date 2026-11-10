import { data, redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/team.purchases.$purchaseId.refund-request";
import { getCurrentUserId } from "~/lib/session";
import { db } from "~/db";
import { courses, purchases, users } from "~/db/schema";
import { eq } from "drizzle-orm";
import { parseFormData, parseParams } from "~/lib/validation";
import { makeTeamPurchaseRefundRequest } from "~/lib/refund-eligibility.server";
import {
  buildTeamPurchaseRefundRequestEmail,
  logEmail,
} from "~/lib/refund-request-emails.server";
import {
  refundRequestSchema,
  refusalStatus,
} from "~/lib/refund-request-action.server";

const paramsSchema = z.object({
  purchaseId: z.coerce.number().int().positive(),
});

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

  logEmail(email);

  return redirect("/team");
}
