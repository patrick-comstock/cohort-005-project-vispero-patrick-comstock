---
status: accepted
---

# Approving a Refund Request deletes the Enrollment

Access (`app/lib/access.server.ts`) and other readers treat a Student as enrolled purely when an Enrollment row exists. So when an Admin Resolves a Refund Request as Approved, we delete the Student's Enrollment row for that course rather than keeping it and marking it as ended. Lesson progress is kept, so if the Student makes a new Purchase, their progress comes back.

## Considered Options

- **Keep the row with an ended/refunded marker (rejected).** No data is lost, but every Enrollment reader would need a filter, and missing one quietly gives a refunded Student Access. Buying again would also need either reactivation or a second row.

## Consequences

- The original enrollment date is lost and can't be recovered. This is acceptable because nothing in the domain uses it: the Purchase and the Refund Request still record who bought, when, and the Resolution.
- Buying again simply creates a new Enrollment.
- If Enrollment history is ever needed, revisit this decision.
- An Enrollment has no link to the Purchase that created it, so the refunded Purchase is inferred: a Student's Refund Request targets their latest Purchase of the course that isn't a Team Purchase (`getRefundRequestPurchase` in `app/lib/refund-requests.server.ts`), and a Team Purchase is recognised by the Purchase having Coupons (`isTeamPurchase`). Adding an explicit link from Enrollment to Purchase would change this.
- Approving a Refund Request for a Team Purchase Voids its Coupons and doesn't touch any Enrollment, because a Team Purchase never enrolls its buyer.
