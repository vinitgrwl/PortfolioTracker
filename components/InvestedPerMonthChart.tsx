"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { formatINR } from "@/lib/format";
import type { MonthlyPoint } from "@/lib/investedPerMonth";

export default function InvestedPerMonthChart({ data }: { data: MonthlyPoint[] }) {
  if (data.length < 2) {
    return (
      <p className="px-3 py-6 text-sm text-ink-soft">
        Not enough history yet — {data.length === 0 ? "no" : "only one"} month of data.
      </p>
    );
  }

  const chartData = data.map((d) => ({
    month: d.month,
    invested: d.investedINR,
    current: d.currentINR,
    cagr: d.cagrPct,
  }));

  return (
    <div className="h-72 px-1 py-3">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--rule)" vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 11, fill: "var(--ink-soft)" }}
            minTickGap={30}
            axisLine={{ stroke: "var(--rule)" }}
            tickLine={false}
          />
          <YAxis
            yAxisId="value"
            tick={{ fontSize: 11, fill: "var(--ink-soft)" }}
            tickFormatter={(v: number) => `₹${(v / 100000).toFixed(0)}L`}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          <YAxis
            yAxisId="cagr"
            orientation="right"
            tick={{ fontSize: 11, fill: "var(--ink-soft)" }}
            tickFormatter={(v: number) => `${v.toFixed(0)}%`}
            axisLine={false}
            tickLine={false}
            width={42}
          />
          <Tooltip
            formatter={(value: number, name: string) => {
              if (name === "CAGR") return [value !== null ? `${value.toFixed(1)}%` : "—", name];
              return [value !== null ? formatINR(value) : "—", name];
            }}
            contentStyle={{
              background: "var(--paper-raised)",
              border: "1px solid var(--rule)",
              borderRadius: 0,
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="value" dataKey="invested" name="Invested" fill="var(--rule)" />
          <Bar yAxisId="value" dataKey="current" name="Current value" fill="var(--brass-soft)" />
          <Line
            yAxisId="cagr"
            type="monotone"
            dataKey="cagr"
            name="CAGR"
            stroke="var(--gain)"
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
