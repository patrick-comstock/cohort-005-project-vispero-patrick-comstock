import { AlertTriangle } from "lucide-react";

import { formatMoney } from "~/lib/analytics";
import type { RefundExposure } from "~/modules/instructor-analytics/index.server";

export function RefundExposurePanel({
  exposure,
}: {
  exposure: RefundExposure;
}) {
  if (exposure.purchaseCount === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Nothing in this period could still be Refunded. All the Revenue above is
        money you have kept.
      </p>
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <span className="text-3xl font-bold">
          {formatMoney(exposure.revenueCents)}
        </span>
        <span className="text-sm text-muted-foreground">
          {exposure.sharePercent}% of Revenue, across {exposure.purchaseCount}{" "}
          {exposure.purchaseCount === 1 ? "purchase" : "purchases"} —{" "}
          {formatMoney(exposure.netEarningsCents)} of it Net Earnings.
        </span>
      </div>

      {exposure.closingTodayCount > 0 && (
        <p className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <AlertTriangle className="size-4" />
          {exposure.closingTodayCount}{" "}
          {exposure.closingTodayCount === 1
            ? "purchase leaves"
            : "purchases leave"}{" "}
          the Refund Window today.
        </p>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="pb-2 font-medium">Course</th>
            <th className="pb-2 text-right font-medium">At risk</th>
            <th className="pb-2 text-right font-medium">Purchases</th>
            <th className="pb-2 text-right font-medium">Soonest to close</th>
          </tr>
        </thead>
        <tbody>
          {exposure.courses.map((course) => (
            <tr key={course.courseId} className="border-b last:border-0">
              <td className="py-3">{course.title}</td>
              <td className="py-3 text-right tabular-nums">
                {formatMoney(course.revenueCents)}
              </td>
              <td className="py-3 text-right tabular-nums">
                {course.purchaseCount}
              </td>
              <td className="py-3 text-right tabular-nums">
                {course.daysLeft === 0
                  ? "Today"
                  : `${course.daysLeft} ${course.daysLeft === 1 ? "day" : "days"}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
