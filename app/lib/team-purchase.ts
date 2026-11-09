export type TeamPurchaseButtonLabel = "Buy More Seats" | "Buy for Your Team";

/**
 * The label of the course page's extra team-purchase button, or null when the
 * viewer gets no such button. A viewer who already has a Team Purchase for the
 * course is offered more seats; an enrolled Student without one is offered a
 * Team Purchase. Visitors without either use the "Buy for Team" tab instead.
 */
export function getTeamPurchaseButtonLabel(viewer: {
  isInstructor: boolean;
  enrolled: boolean;
  hasTeamPurchase: boolean;
}): TeamPurchaseButtonLabel | null {
  if (viewer.isInstructor) return null;
  if (viewer.hasTeamPurchase) return "Buy More Seats";
  if (viewer.enrolled) return "Buy for Your Team";
  return null;
}
