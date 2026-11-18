import { Link } from "react-router";

import { Card, CardContent } from "~/components/ui/card";
import { formatMoney, PLATFORM_FEE_PERCENT } from "~/lib/analytics";
import { REFUND_WINDOW_DAYS } from "~/lib/refund-window";
import type { AnalyticsPage } from "~/modules/instructor-analytics/index.server";

import { NoSales } from "./no-sales";
import { RefundExposurePanel } from "./refund-exposure-panel";
import { RevenueChart } from "./revenue-chart";
import { TopBuyers } from "./top-buyers";

function MoneyCard({
  label,
  amountCents,
  hint,
  emphasis,
}: {
  label: string;
  amountCents: number;
  hint: string;
  emphasis?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="text-sm font-medium text-muted-foreground">{label}</div>
        <div
          className={
            emphasis
              ? "mt-2 text-3xl font-bold text-primary"
              : "mt-2 text-3xl font-bold"
          }
        >
          {formatMoney(amountCents)}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

/**
 * A single figure with its own empty copy.
 *
 * Every panel says what it means when it has nothing, so an instructor can
 * tell "nothing has happened yet" from "this is broken".
 */
function StatCard({
  label,
  value,
  hint,
  emptyHint,
  action,
}: {
  label: string;
  value: string | number;
  hint: string;
  /** Shown instead of `hint` when the figure is zero — and greys the figure. */
  emptyHint?: string;
  action?: React.ReactNode;
}) {
  const empty = emptyHint !== undefined && (value === 0 || value === "—");

  return (
    <Card>
      <CardContent className="p-6">
        <div className="text-sm font-medium text-muted-foreground">{label}</div>
        <div
          className={
            empty
              ? "mt-2 text-3xl font-bold text-muted-foreground"
              : "mt-2 text-3xl font-bold"
          }
        >
          {value}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {empty ? emptyHint : hint}
        </p>
        {action}
      </CardContent>
    </Card>
  );
}

/** The Overview tab: the period's money, audience and Refund exposure. */
export function OverviewTab({
  summary,
  audience,
  questions,
  ratings,
  series,
  buyers,
  refundExposure,
}: Pick<
  AnalyticsPage,
  | "summary"
  | "audience"
  | "questions"
  | "ratings"
  | "series"
  | "buyers"
  | "refundExposure"
>) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MoneyCard
          label="Gross Sales"
          amountCents={summary.grossSalesCents}
          hint="What students paid, before Refunds."
        />
        <MoneyCard
          label="Refunds"
          amountCents={summary.refundCents}
          hint={`${summary.refundCount} ${
            summary.refundCount === 1 ? "Refund Request" : "Refund Requests"
          } Approved.`}
        />
        <MoneyCard
          label="Revenue"
          amountCents={summary.revenueCents}
          hint={`Gross Sales minus Refunds, across ${
            summary.purchaseCount
          } ${summary.purchaseCount === 1 ? "purchase" : "purchases"}.`}
        />
        <MoneyCard
          label={`Platform fee (${PLATFORM_FEE_PERCENT}%)`}
          amountCents={summary.feeCents}
          hint="Cadence's cut of Revenue."
        />
        <MoneyCard
          label="Net Earnings"
          amountCents={summary.netEarningsCents}
          hint="What you keep — Revenue minus the platform fee."
          emphasis
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Buyers"
          value={audience.buyerCount}
          hint="People who paid. A team buying several coupons counts once."
          emptyHint="Nobody has bought in this period."
        />
        <StatCard
          label="Enrolled students"
          value={audience.studentCount}
          hint={`Students with access, redeemed coupons included.${
            audience.revenuePerStudentCents === null
              ? ""
              : ` ${formatMoney(audience.revenuePerStudentCents)} of Revenue each.`
          }`}
          emptyHint="Nobody has enrolled in this period."
        />
        <StatCard
          label="Unanswered questions"
          value={questions.inRange}
          hint={
            questions.older > 0
              ? `Plus ${questions.older} from before this period.`
              : "Students waiting on a reply."
          }
          // Quiet this period is only good news if the backlog is empty
          // too, so the older count keeps its place in the empty copy.
          emptyHint={
            questions.older > 0
              ? `None this period, but ${questions.older} still waiting from before.`
              : "Nothing is waiting on you."
          }
          action={
            questions.inRange + questions.older > 0 ? (
              <Link
                to="/instructor/questions"
                className="mt-3 inline-block text-xs font-medium text-primary hover:underline"
              >
                Answer them
              </Link>
            ) : null
          }
        />
        <StatCard
          label="Course rating"
          value={ratings.average === null ? "—" : `${ratings.average} ★`}
          hint={`Across ${ratings.count} ${
            ratings.count === 1 ? "rating" : "ratings"
          }.`}
          emptyHint="Nobody has rated your courses in this period."
        />
      </div>

      <Card>
        <CardContent className="p-6">
          <h2 className="mb-4 text-lg font-semibold">Revenue over time</h2>
          {/* Keyed on the sales themselves, not on the points: a fixed
              range always spans its whole window, so an instructor with
              no sales would otherwise get a flat line along zero rather
              than being told there is nothing there. */}
          {summary.purchaseCount === 0 ? (
            // Nothing kept, so any Refund means every sale was Refunded.
            <NoSales isAllRefunded={summary.refundCount > 0} />
          ) : (
            <RevenueChart series={series} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <h2 className="text-lg font-semibold">Top buyers</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Your ten biggest spenders in this period, after Refunds — the people
            worth reaching out to.
          </p>
          <TopBuyers buyers={buyers} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <h2 className="text-lg font-semibold">Refund exposure</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Revenue in this period that could still go back out as a Refund:
            Purchases inside their {REFUND_WINDOW_DAYS}-day Refund Window with
            no Refund Request yet, or one still Pending.
          </p>
          <RefundExposurePanel exposure={refundExposure} />
        </CardContent>
      </Card>
    </>
  );
}
