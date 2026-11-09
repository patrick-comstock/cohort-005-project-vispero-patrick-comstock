# Course Platform

The shared domain language for this course platform. Agents and human developers read it before naming things, and update it when a term is settled.

## Language

### People and purchases

**Student**:
A user who buys and takes courses.
_Avoid_: Learner

**Purchase**:
A Student's, or a Team Purchase buyer's, payment for a course.

**Team Purchase**:
A Purchase of a course for a team, distributed to its members through Coupons.

**Coupon**:
The code from a Team Purchase that grants one person the course. "Seat" is acceptable only in buyer-facing copy about buying Coupons for a Team Purchase (such as "Buy More Seats"); everywhere else, say Coupon.
_Avoid_: Seat

**Redeem**:
When a person uses a Coupon to get the course.
_Avoid_: Claimed

**Enrollment**:
A Student's membership in a course, created by a Purchase or by Redeeming a Coupon.

**Access**:
Whether someone can currently view a course's content.

### Refunds

**Refund Request**:
A Student's ask to get their money back for a Purchase; its status is Pending, Approved, or Declined. "Cancel" is reserved for generic UI dismissal and is never used for refunds.
_Avoid_: Cancel, cancellation (of a purchase), reversal, chargeback, money back, give back

**Refund**:
The money actually returned to the Student once a Refund Request is Approved. Distinct from the Refund Request itself.

**Pending**:
The status of a Refund Request that has not yet been Resolved.
_Avoid_: Open, requested

**Approved**:
The status of a Refund Request that staff accepted, leading to a Refund.

**Declined**:
The status of a Refund Request that staff turned down.

**Resolve**:
Staff moving a Pending Refund Request to Approved or Declined; the outcome is its Resolution.

### Refund Eligibility

**Refund Eligibility**:
Whether a Student may make a Refund Request for a Purchase, made up of the Refund Window, Watch-Time Limit, and Completion Limit.

**Refund Window**:
The 14-day period after a Purchase during which a Refund Request may be made.

**Watch-Time Limit**:
The maximum video watched (under 2 hours) for a Refund Request to be allowed.

**Completion Limit**:
The maximum share of lessons completed (under 50%) for a Refund Request to be allowed.

### Outside this system

**Chargeback**:
A dispute a card holder raises with their bank. Not modelled in this system; never used for a Refund Request.
