import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "~/components/ui/chart";
import { formatBucket, formatMoney } from "~/lib/analytics";
import type { RevenueSeries } from "~/lib/revenue.server";

const chartConfig = {
  revenueCents: { label: "Revenue", color: "var(--chart-1)" },
  netEarningsCents: { label: "Net Earnings", color: "var(--chart-2)" },
} satisfies ChartConfig;

export function RevenueChart({ series }: { series: RevenueSeries }) {
  return (
    <ChartContainer config={chartConfig} className="h-64 w-full">
      <AreaChart data={series.points} margin={{ left: 12, right: 12 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="bucket"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tickFormatter={formatBucket}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={72}
          tickFormatter={(cents: number) => formatMoney(cents)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(label) => formatBucket(String(label))}
              formatter={(value, name) => (
                <span className="flex w-full justify-between gap-4">
                  <span className="text-muted-foreground">
                    {chartConfig[name as keyof typeof chartConfig]?.label ??
                      name}
                  </span>
                  <span className="font-mono font-medium">
                    {formatMoney(Number(value))}
                  </span>
                </span>
              )}
            />
          }
        />
        <Area
          dataKey="revenueCents"
          type="monotone"
          stroke="var(--color-revenueCents)"
          fill="var(--color-revenueCents)"
          fillOpacity={0.2}
        />
        <Area
          dataKey="netEarningsCents"
          type="monotone"
          stroke="var(--color-netEarningsCents)"
          fill="var(--color-netEarningsCents)"
          fillOpacity={0.2}
        />
      </AreaChart>
    </ChartContainer>
  );
}
