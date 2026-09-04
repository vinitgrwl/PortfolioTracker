"use client";

import { useRouter } from "next/navigation";
import type { ScreenerOption } from "@/lib/screener";

export default function ScreenerPicker({ options, activeKey }: { options: ScreenerOption[]; activeKey: string | null }) {
  const router = useRouter();

  return (
    <select
      value={activeKey ?? ""}
      onChange={(e) => router.push(`/screener?key=${encodeURIComponent(e.target.value)}`)}
      className="input max-w-md"
    >
      {options.map((o) => (
        <option key={o.key} value={o.key}>
          {o.ticker}
          {o.assetName && o.assetName !== o.ticker ? ` — ${o.assetName}` : ""} ({o.currency})
        </option>
      ))}
    </select>
  );
}
