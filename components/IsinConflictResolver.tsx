"use client";

import { useState, useTransition } from "react";
import { findIsinConflicts, resolveIsinConflict } from "@/lib/actions-isin";
import type { IsinConflict } from "@/lib/actions-isin";

export default function IsinConflictResolver() {
  const [conflicts, setConflicts] = useState<IsinConflict[] | null>(null);
  const [pending, startTransition] = useTransition();

  if (conflicts === null) {
    return (
      <div className="px-3 py-4">
        <p className="text-xs text-ink-soft mb-2">
          If a holding shows up more than once (like a stock split across several duplicate rows), it&rsquo;s
          usually because different transactions for it were logged with different ISINs — this checks for
          that and lets you pick the right one.
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(async () => setConflicts(await findIsinConflicts()))}
          className="border border-rule px-3 py-1.5 text-xs text-ink-soft hover:text-ink disabled:opacity-60"
        >
          {pending ? "Checking…" : "Check for ISIN conflicts"}
        </button>
      </div>
    );
  }

  if (conflicts.length === 0) {
    return <p className="px-3 py-4 text-sm text-ink-soft">No conflicts found — every ticker uses one consistent ISIN.</p>;
  }

  return (
    <div className="px-3 py-3">
      {conflicts.map((c) => (
        <div key={`${c.ticker}::${c.country}`} className="mb-4 pb-4 border-b border-rule last:border-b-0 last:mb-0 last:pb-0">
          <p className="text-sm mb-2">
            <strong>{c.ticker}</strong> <span className="text-ink-soft">({c.country})</span> — {c.isins.length}{" "}
            different ISINs recorded
            {c.noIsinCount > 0 ? `, plus ${c.noIsinCount} row(s) with none` : ""}.
          </p>
          <p className="text-xs text-ink-soft mb-2">
            Pick the correct ISIN (check it on the exchange/broker if unsure) — every transaction for{" "}
            {c.ticker} will be set to it.
          </p>
          <div className="flex flex-wrap gap-2">
            {c.isins.map((i) => (
              <form
                key={i.isin}
                action={async (fd) => {
                  await resolveIsinConflict(fd);
                  setConflicts((prev) => prev?.filter((x) => x.ticker !== c.ticker || x.country !== c.country) ?? null);
                }}
              >
                <input type="hidden" name="ticker" value={c.ticker} />
                <input type="hidden" name="country" value={c.country} />
                <input type="hidden" name="isin" value={i.isin} />
                <button
                  type="submit"
                  className="text-xs bg-white border border-rule px-2 py-1 hover:border-ink"
                >
                  {i.isin} ({i.count} row{i.count === 1 ? "" : "s"})
                </button>
              </form>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
