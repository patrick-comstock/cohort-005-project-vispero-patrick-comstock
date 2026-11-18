import { formatMoney, PLATFORM_FEE_PERCENT } from "~/lib/analytics";
import type { AnalyticsPage } from "~/modules/instructor-analytics/index.server";

import { NoSales } from "./no-sales";

/** Revenue, the platform fee and Net Earnings, one row per course. */
export function RevenueByCourse({
  rows,
  isAllRefunded,
}: {
  rows: AnalyticsPage["courses"];
  /** Whether an empty table means every sale was Refunded, not none made. */
  isAllRefunded: boolean;
}) {
  if (rows.length === 0) return <NoSales isAllRefunded={isAllRefunded} />;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          <th className="pb-2 font-medium">Course</th>
          <th className="pb-2 text-right font-medium">Sales</th>
          <th className="pb-2 text-right font-medium">Revenue</th>
          <th className="pb-2 text-right font-medium">
            Fee ({PLATFORM_FEE_PERCENT}%)
          </th>
          <th className="pb-2 text-right font-medium">Net Earnings</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((course) => (
          <tr key={course.courseId} className="border-b">
            <td className="py-3 font-medium">{course.title}</td>
            <td className="py-3 text-right tabular-nums">
              {course.purchaseCount}
            </td>
            <td className="py-3 text-right tabular-nums">
              {formatMoney(course.revenueCents)}
            </td>
            <td className="py-3 text-right tabular-nums text-muted-foreground">
              {formatMoney(course.feeCents)}
            </td>
            <td className="py-3 text-right font-medium tabular-nums">
              {formatMoney(course.netEarningsCents)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
