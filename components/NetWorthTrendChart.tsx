"use client";

import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { formatINR } from "@/lib/format";

export default function NetWorthTrendChart({
  data,
}: {
  data: { snapshot_date: string; total_inr: number }[];
}) {
  if (data.length < 2) {
    return (
      <p className="px-3 py-6 text-sm text-ink-soft">
        Not enough history yet — {data.length === 0 ? "no" : "only one"} snapshot recorded.
        Use &ldquo;Build Full History&rdquo; below to reconstruct past net worth from your
        transaction ledger.
      </p>
    );
  }

  const chartData = data.map((d) => ({ date: d.snapshot_date, value: d.total_inr }));

  return (
    <div className="h-64 px-1 py-3">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="netWorthFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--brass)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--brass)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--rule)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "var(--ink-soft)" }}
            tickFormatter={(v: string) => v.slice(5)}
            minTickGap={40}
            axisLine={{ stroke: "var(--rule)" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--ink-soft)" }}
            tickFormatter={(v: number) => `₹${(v / 100000).toFixed(0)}L`}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          <Tooltip
            formatter={(value: number) => [formatINR(value), "Net worth"]}
            labelFormatter={(label: string) => label}
            contentStyle={{
              background: "var(--paper-raised)",
              border: "1px solid var(--rule)",
              borderRadius: 0,
              fontSize: 12,
            }}
          />
          <Area type="monotone" dataKey="value" stroke="var(--brass)" strokeWidth={2} fill="url(#netWorthFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
