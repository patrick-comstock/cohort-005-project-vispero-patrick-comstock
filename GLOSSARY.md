# Course Platform

The shared domain language for this course platform. Agents and human developers read it before naming things, and update it when a term is settled.

## Language

### People and purchases

**Student**:
A user who buys and takes courses.
_Avoid_: Learner

**Instructor**:
A user who creates and teaches courses.

**Purchase**:
A Student's, or a Team Purchase buyer's, payment for a course.

**Team Purchase**:
A Purchase of a course for a team, distributed to its members through Coupons.

**Coupon**:
The code from a Team Purchase that grants one person the course. "Seat" is acceptable only in buyer-facing copy about buying Coupons for a Team Purchase (such as "Buy More Seats"); everywhere else, say Coupon.
_Avoid_: Seat

**Redeem**:
When a person uses a Coupon to get the course. A Coupon can't be Redeemed while its Team Purchase has a Pending Refund Request.
_Avoid_: Claimed

**Voided**:
A Coupon that can no longer be Redeemed because its Team Purchase was Refunded.
_Avoid_: Revoked, Cancelled, Expired, Invalidated

**Enrollment**:
A Student's membership in a course, created by a Purchase or by Redeeming a Coupon.

**Access**:
Whether someone can currently view a course's content.

**Admin**:
A person who runs the platform and Resolves Refund Requests. Not the person managing a Team.
_Avoid_: Staff, moderator

### Refunds

**Refund Request**:
A Student's or Team Purchase buyer's ask to get their money back for a Purchase; its status is Pending, Approved, or Declined. "Cancel" is reserved for generic UI dismissal and is never used for refunds.
_Avoid_: Cancel, cancellation (of a purchase), reversal, chargeback, money back, give back

**Refund**:
The money actually returned to whoever made the Purchase once a Refund Request is Approved. Distinct from the Refund Request itself.

**Pending**:
The status of a Refund Request that has not yet been Resolved.
_Avoid_: Open, requested

**Approved**:
The status of a Refund Request that an Admin accepted, leading to a Refund.

**Declined**:
The status of a Refund Request that an Admin turned down.
_Avoid_: Deny, Denied, Reject

**Resolve**:
An Admin moving a Pending Refund Request to Approved or Declined; the outcome is its Resolution. Only Admins Resolve.

- A Resolution is final.
- A Purchase can have at most one Refund Request, ever.
- When a request is Approved, the Refund is the full amount paid for the Purchase, and the Student loses their Enrollment (and therefore Access).
- Refund Eligibility is judged when the request is made, not when it is Resolved.

**Resolution Note**:
The Admin's explanation of a Resolution, which the Student sees. Required when Declining; optional when Approving.

**Repeat Refund Request**:
A Refund Request from someone who has already had a Refund Request Approved for the same course. It is information for the Admin and never blocks Resolving it.

### Refund Eligibility

**Refund Eligibility**:
Whether a Refund Request may be made for a Purchase. For a Student's own Purchase it is the Refund Window, Watch-Time Limit, and Completion Limit; for a Team Purchase, whose buyer has no Enrollment, it is the Refund Window and none of its Coupons having been Redeemed.

**Refund Window**:
The 14-day period after a Purchase during which a Refund Request may be made.

**Watch-Time Limit**:
The maximum video watched (under 2 hours) for a Refund Request to be allowed.

**Completion Limit**:
The maximum share of lessons completed (under 50%) for a Refund Request to be allowed.

### Earnings

**Gross Sales**:
What was paid for Purchases, before any Refunds.
_Avoid_: Gross revenue, gross

**Revenue**:
Gross Sales minus Refunds: the money from Purchases that was kept.
_Avoid_: Net revenue, sales, income

**Net Earnings**:
The instructor's share of Revenue, after the platform fee.
_Avoid_: Net, payout, profit, take-home

### Outside this system

**Chargeback**:
A dispute a card holder raises with their bank. Not modelled in this system; never used for a Refund Request.
