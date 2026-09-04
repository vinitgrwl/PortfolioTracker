"use client";

import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from "recharts";
import { formatINR } from "@/lib/format";

const PALETTE = [
  "var(--brass)",
  "var(--gain)",
  "var(--ink)",
  "var(--brass-soft)",
  "var(--loss)",
  "var(--ink-soft)",
];

export default function AllocationChart({
  data,
  title,
}: {
  data: { name: string; value: number }[];
  title: string;
}) {
  const positive = data.filter((d) => d.value > 0);

  if (positive.length === 0) {
    return null;
  }

  return (
    <div>
      <h2 className="text-sm text-ink-soft mb-2">{title}</h2>
      <div className="bg-paper-raised border border-rule h-64 flex items-center">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={positive}
              dataKey="value"
              nameKey="name"
              innerRadius="45%"
              outerRadius="75%"
              paddingAngle={1}
            >
              {positive.map((entry, i) => (
                <Cell key={entry.name} fill={PALETTE[i % PALETTE.length]} stroke="var(--paper-raised)" />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number) => formatINR(value)}
              contentStyle={{
                background: "var(--paper-raised)",
                border: "1px solid var(--rule)",
                borderRadius: 0,
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: "var(--ink-soft)" }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
