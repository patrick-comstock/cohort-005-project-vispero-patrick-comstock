---
status: accepted
---

# Analytics count the sales made in a period and kept

Revenue analytics answer "what did the sales made in this period bring in, and what was kept?" A Refund lowers Revenue in the period of its Purchase's date, not the period in which its Refund Request was Approved, and the platform fee is charged on Revenue (Gross Sales minus Refunds), not on Gross Sales. This was the trade-off chosen in PR #17 when fixing issue #9 (analytics ignored Refunds): each Purchase is either kept or Refunded, so Revenue, Purchase counts and every breakdown (by course, country, buyer) agree with one another, and an Instructor is never charged a fee on money that was returned. The rule is stated in the header of `app/lib/revenue.server.ts`, and the fee is split from Revenue by `splitRevenue` in `app/lib/analytics.ts`.

## Considered Options

- **Cash basis: money counts in the period it actually moved (rejected).** Gross Sales would count on the Purchase's date and the Refund on the date it was Approved. Past figures would never change, but a period could show negative Revenue, and a Refunded Purchase could not simply drop out of the counts and breakdowns, because its sale and its Refund would sit in different periods.

## Consequences

- Approving a Refund Request today can lower Revenue, the platform fee and Net Earnings for a past period. Figures for a closed period are not final while its Purchases are still inside the Refund Window.
- Refunded Purchases are left out of counts (Purchases, buyers, top buyers' Purchases and Coupons), and a course or country whose every Purchase was Refunded drops out of its table.
- Pending and Declined Refund Requests have no Refund, so their Purchases count in full until an Approval.
- Paying Instructors out per period, or reconciling against a real payment provider, would need cash-basis figures alongside these. Revisit this together with ADR 0003 when a payment provider is added.
