import { z } from "zod";
import type {
  RefundRequestRefusalCode,
  TeamPurchaseRefundRequestRefusalCode,
} from "~/lib/refund-eligibility.server";

/** The form a Requester submits to make a Refund Request. */
export const refundRequestSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, "Tell us a little more about why you want a refund.")
    .max(1000, "Please keep your reason under 1000 characters."),
});

/** The HTTP status a Refund Request action throws for each refusal. */
export const refusalStatus: Record<
  RefundRequestRefusalCode | TeamPurchaseRefundRequestRefusalCode,
  number
> = {
  "not-enrolled": 403,
  "joined-with-coupon": 403,
  "joined-with-own-coupon": 403,
  "no-purchase": 403,
  "already-requested": 409,
  "outside-refund-window": 403,
  "completion-limit": 403,
  "watch-time-limit": 403,
  "not-found": 404,
  "not-buyer": 403,
  "not-team-purchase": 400,
  "coupon-redeemed": 403,
};
