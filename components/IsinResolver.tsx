"use client";

import { useActionState, useState } from "react";
import { resolveIsinAction, type ResolveIsinState, type UnresolvedTicker } from "@/lib/actions-isin";
import NseEquityPicker from "./NseEquityPicker";
import type { NseEquityRecord } from "@/lib/nseEquityIndex";

const initialState: ResolveIsinState = { status: "idle" };

export default function IsinResolver({ tickers }: { tickers: UnresolvedTicker[] }) {
  const [rows, setRows] = useState(tickers);
  const [state, dispatch, pending] = useActionState(resolveIsinAction, initialState);

  function updateRow(index: number, equity: NseEquityRecord) {
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, symbol: equity.symbol, isin: equity.isin, name: equity.name, confident: true } : r))
    );
  }

  if (state.status === "done") {
    return (
      <p className="px-3 py-4 text-sm text-gain">
        Updated {state.updated} transaction{state.updated === 1 ? "" : "s"} with a matched ISIN. Re-open this
        page if any tickers are still listed below.
      </p>
    );
  }

  const confirmedCount = rows.filter((r) => r.isin).length;

  return (
    <div className="px-3 py-4">
      <p className="text-xs text-ink-soft mb-3">
        These holdings came in without an ISIN (currently only AngelOne imports lack one), so they
        can&rsquo;t automatically merge with the same company held via another broker. Confirm or
        correct the match for each — only confident, exact matches are pre-filled.
      </p>

      <div className="divide-y divide-rule border border-rule mb-4">
        {rows.map((r, i) => (
          <div key={r.ticker} className="px-3 py-3 grid grid-cols-1 md:grid-cols-2 gap-2 items-center">
            <div className="text-xs">
              <div className="text-ink">{r.ticker}</div>
              <div className="text-ink-soft">
                {r.count} transaction{r.count === 1 ? "" : "s"}
                {r.isin && !r.confident && <span className="text-brass"> — low-confidence guess, please check</span>}
              </div>
            </div>
            <NseEquityPicker
              value={r.isin ? { symbol: r.symbol!, isin: r.isin, name: r.name! } : null}
              onSelect={(equity) => updateRow(i, equity)}
            />
          </div>
        ))}
      </div>

      <form action={dispatch}>
        <input type="hidden" name="rows_json" value={JSON.stringify(rows.map((r) => ({ ticker: r.ticker, isin: r.isin })))} />
        <button
          type="submit"
          disabled={pending || confirmedCount === 0}
          className="bg-ink text-paper-raised text-sm px-4 py-2 disabled:opacity-60"
        >
          {pending ? "Updating…" : `Apply ${confirmedCount} match${confirmedCount === 1 ? "" : "es"}`}
        </button>
      </form>

      {state.status === "error" && <p className="text-sm text-loss mt-3">{state.message}</p>}
    </div>
  );
}
