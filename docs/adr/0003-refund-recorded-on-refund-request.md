---
status: accepted
---

# A Refund is recorded on its Refund Request, not as its own record

The glossary treats a Refund (the money returned) and a Refund Request (the Student's ask) as distinct concepts, but a Refund has no record of its own. It is the refund amount (`refund_requests.refund_amount`, `app/db/schema.ts`) on an Approved Refund Request, set when the request is Approved (`resolveRefundRequest` in `app/lib/refund-requests.server.ts`). Payments are simulated and there is no payment provider, so a Refund is recorded, not executed. This shape came from PR #4, which renamed the template's `refunds` table to `refund_requests` instead of splitting it, and was confirmed deliberately during the design work for issue #12.

## Considered Options

- **A separate Refund record for money movements alongside the Refund Request (rejected for now).** With no payment provider, it would only duplicate the amount already on the Approved Refund Request.

## Consequences

- Revenue analytics (#9) reads Refunds from Approved Refund Requests.
- Revisit this when a real payment provider is added. Provider refund IDs, partial or failed Refunds, and Refund timing will probably need their own record, and that change needs a schema split and a data migration.
