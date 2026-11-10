---
status: accepted
---

# A Purchase can have at most one Refund Request, ever

A Resolution is final, so a Purchase gets one Refund Request and no more. If a Student could ask again, they could reopen a Declined decision. The rule lives in the database as a unique index on `refund_requests.purchase_id` (`app/db/schema.ts`, migration `drizzle/0011_reflective_vargas.sql`), so two requests arriving at the same moment can't both get in. `makeRefundRequest` (`app/lib/refund-requests.server.ts`) relies on that index with `onConflictDoNothing` instead of checking first.

## Considered Options

- **Block a new Refund Request only while one is Pending (the course template's rule, rejected).** This let a Student ask again after a Decline, or even after an Approval.
- **Allow a new Refund Request after a Decline only (rejected).** This still reopens a final Resolution.
- **Enforce the rule in app code only (rejected).** A check-then-insert lets two concurrent requests both get through.

## Consequences

- The migration fails on a database that already has more than one Refund Request for a Purchase.
- Relaxing the rule later means dropping the unique index and replacing its race protection with something else.
- Buying the course again creates a new Purchase, and that Purchase can have its own Refund Request.
