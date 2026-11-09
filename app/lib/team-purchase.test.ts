import { describe, it, expect } from "vitest";
import { getTeamPurchaseButtonLabel } from "./team-purchase";

describe("getTeamPurchaseButtonLabel", () => {
  it("offers more seats to a Team Purchase buyer who is enrolled", () => {
    expect(
      getTeamPurchaseButtonLabel({
        isInstructor: false,
        enrolled: true,
        hasTeamPurchase: true,
      })
    ).toBe("Buy More Seats");
  });

  it("offers more seats to a Team Purchase buyer who is not enrolled", () => {
    expect(
      getTeamPurchaseButtonLabel({
        isInstructor: false,
        enrolled: false,
        hasTeamPurchase: true,
      })
    ).toBe("Buy More Seats");
  });

  it("offers an enrolled Student without a Team Purchase to buy for their team", () => {
    expect(
      getTeamPurchaseButtonLabel({
        isInstructor: false,
        enrolled: true,
        hasTeamPurchase: false,
      })
    ).toBe("Buy for Your Team");
  });

  it("shows no extra button to a visitor who is not enrolled and has no Team Purchase", () => {
    expect(
      getTeamPurchaseButtonLabel({
        isInstructor: false,
        enrolled: false,
        hasTeamPurchase: false,
      })
    ).toBeNull();
  });

  it("shows no button to the instructor", () => {
    expect(
      getTeamPurchaseButtonLabel({
        isInstructor: true,
        enrolled: true,
        hasTeamPurchase: true,
      })
    ).toBeNull();
  });
});
