import { formatPrice } from "~/lib/utils";
import { RefundRequestStatus } from "~/db/schema";
import type { Resolution } from "~/lib/refund-request-resolve.server";

/**
 * The email that tells the Requester how their Refund Request was Resolved.
 * There is no mail transport wired up yet, so callers log the message.
 */
export function buildRefundRequestResolvedEmail(input: {
  requesterName: string;
  requesterEmail: string;
  courseTitle: string;
  status: Resolution;
  isTeamPurchase: boolean;
  refundAmount: number | null;
  resolutionNote: string | null;
}) {
  const isApproved = input.status === RefundRequestStatus.Approved;
  const outcome = isApproved
    ? [
        `Your Refund Request for "${input.courseTitle}" has been approved.`,
        `We are refunding ${formatPrice(input.refundAmount)}, the amount you paid.`,
        input.isTeamPurchase
          ? "Its Coupons have been Voided and can no longer be Redeemed. Anyone who already Redeemed one keeps the course."
          : "Your access to the course has ended.",
      ]
    : input.isTeamPurchase
      ? [
          `Your Refund Request for "${input.courseTitle}" has been declined, so there is no Refund.`,
          "Its unredeemed Coupons can still be Redeemed.",
        ]
      : [
          `Your Refund Request for "${input.courseTitle}" has been declined, and you keep your access to the course.`,
        ];

  return {
    to: input.requesterEmail,
    subject: `Refund Request ${isApproved ? "approved" : "declined"} — ${input.courseTitle}`,
    body: [
      `Hi ${input.requesterName},`,
      "",
      ...outcome,
      ...(input.resolutionNote ? ["", input.resolutionNote] : []),
      "",
      "— The Cadence team",
    ].join("\n"),
  };
}

/**
 * The confirmation a Student gets when they make a Refund Request. There is
 * no mail transport wired up yet, so callers log the message.
 */
export function buildRefundRequestEmail(input: {
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

/**
 * The confirmation a Team Purchase buyer gets when they make a Refund Request
 * for it. There is no mail transport wired up yet, so callers log the message.
 */
export function buildTeamPurchaseRefundRequestEmail(input: {
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

/** Sends a built email to the server log, until a mail transport is wired up. */
export function logEmail(email: { to: string; subject: string; body: string }) {
  console.log(`[email] to=${email.to} subject=${email.subject}\n${email.body}`);
}
