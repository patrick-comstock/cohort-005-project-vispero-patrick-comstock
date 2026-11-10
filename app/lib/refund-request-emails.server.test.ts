import { describe, expect, it } from "vitest";
import { RefundRequestStatus } from "~/db/schema";
import { buildRefundRequestResolvedEmail } from "./refund-request-emails.server";

describe("buildRefundRequestResolvedEmail", () => {
  const student = {
    requesterName: "Sam",
    requesterEmail: "sam@example.com",
    courseTitle: "Test Course",
  };

  it("tells a Team Purchase buyer their Coupons were Voided, not that they lost Access", () => {
    const email = buildRefundRequestResolvedEmail({
      ...student,
      status: RefundRequestStatus.Approved,
      isTeamPurchase: true,
      refundAmount: 9998,
      resolutionNote: null,
    });

    expect(email.body).toContain("$99.98");
    expect(email.body).toContain("Coupons");
    expect(email.body).not.toContain("access");
  });

  it("tells a Team Purchase buyer their unredeemed Coupons can still be Redeemed when Declined, not that they keep Access", () => {
    const email = buildRefundRequestResolvedEmail({
      ...student,
      status: RefundRequestStatus.Declined,
      isTeamPurchase: true,
      refundAmount: null,
      resolutionNote: "Outside our policy.",
    });

    expect(email.subject).toContain("declined");
    expect(email.body).toContain("Coupons");
    expect(email.body).toContain("Its unredeemed Coupons can still be Redeemed.");
    expect(email.body).not.toContain("access");
  });

  it("tells a Student they keep their access to the course when Declined", () => {
    const email = buildRefundRequestResolvedEmail({
      ...student,
      status: RefundRequestStatus.Declined,
      isTeamPurchase: false,
      refundAmount: null,
      resolutionNote: "Outside our policy.",
    });

    expect(email.body).toContain(
      'Your Refund Request for "Test Course" has been declined, and you keep your access to the course.'
    );
    expect(email.body).not.toContain("Coupon");
  });

  it("includes the Resolution Note when Declined", () => {
    const email = buildRefundRequestResolvedEmail({
      ...student,
      status: RefundRequestStatus.Declined,
      isTeamPurchase: false,
      refundAmount: null,
      resolutionNote: "Outside our policy.",
    });

    expect(email.subject).toContain("declined");
    expect(email.body).toContain("Outside our policy.");
  });
});
