"use client";

import { useState, useTransition } from "react";
import { addCorporateAction, deleteCorporateAction, autoFetchCorporateActions } from "@/lib/actions-corp-actions";
import type { CorporateAction } from "@/lib/types";

export default function CorporateActionsManager({ actions }: { actions: CorporateAction[] }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  return (
    <div>
      <div className="px-3 py-3 border-b border-rule bg-paper flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-ink-soft">
          Splits and bonus issues, applied automatically to holdings and realized P&amp;L by date. US tickers
          auto-fetch reliably via Yahoo Finance; India tickers are best-effort (NSE blocks a lot of automated
          requests) — add those manually if auto-fetch comes up empty.
        </p>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await autoFetchCorporateActions();
                const indiaNote = res.indiaAttempted
                  ? ` (India auto-fetch found ${res.indiaFound} — add manually for tickers it missed.)`
                  : "";
                setResult(`Checked ${res.checked} securities, added ${res.added} new action(s).${indiaNote}`);
              })
            }
            className="border border-rule px-3 py-1.5 text-xs text-ink-soft hover:text-ink disabled:opacity-60"
          >
            {pending ? "Checking…" : "Auto-fetch"}
          </button>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="border border-rule px-3 py-1.5 text-xs text-ink-soft hover:text-ink"
          >
            {showForm ? "Cancel" : "Add manually"}
          </button>
        </div>
      </div>

      {result && <p className="px-3 py-2 text-xs text-ink-soft border-b border-rule">{result}</p>}

      {showForm && (
        <form
          action={async (fd) => {
            await addCorporateAction(fd);
            setShowForm(false);
          }}
          className="px-3 py-3 border-b border-rule flex flex-wrap gap-2 items-end"
        >
          <label className="text-xs text-ink-soft">
            Ticker
            <input name="asset_ticker" required className="input mt-1 block w-24" placeholder="NFLX" />
          </label>
          <label className="text-xs text-ink-soft">
            ISIN (optional)
            <input name="isin" className="input mt-1 block w-32" />
          </label>
          <label className="text-xs text-ink-soft">
            Country
            <select name="country" required className="input mt-1 block">
              <option value="India">India</option>
              <option value="United States">United States</option>
            </select>
          </label>
          <label className="text-xs text-ink-soft">
            Type
            <select name="action_type" required className="input mt-1 block">
              <option value="split">Split</option>
              <option value="bonus">Bonus</option>
            </select>
          </label>
          <label className="text-xs text-ink-soft">
            Ratio — from
            <input
              name="ratio_from"
              type="number"
              step="any"
              required
              className="input mt-1 block w-20"
              placeholder="1"
            />
          </label>
          <label className="text-xs text-ink-soft">
            Ratio — to
            <input
              name="ratio_to"
              type="number"
              step="any"
              required
              className="input mt-1 block w-20"
              placeholder="5"
            />
          </label>
          <label className="text-xs text-ink-soft">
            Ex-date
            <input name="ex_date" type="date" required className="input mt-1 block" />
          </label>
          <button type="submit" className="border border-rule px-3 py-1.5 text-xs text-ink-soft hover:text-ink">
            Add
          </button>
        </form>
      )}

      {actions.length > 0 && (
        <table className="ledger">
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Country</th>
              <th>Type</th>
              <th>Ratio</th>
              <th>Ex-date</th>
              <th>Source</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {actions
              .slice()
              .sort((a, b) => b.ex_date.localeCompare(a.ex_date))
              .map((a) => (
                <tr key={a.id}>
                  <td>{a.asset_ticker}</td>
                  <td>{a.country}</td>
                  <td className="capitalize">{a.action_type}</td>
                  <td>
                    {a.ratio_from}:{a.ratio_to}
                  </td>
                  <td className="whitespace-nowrap">{a.ex_date}</td>
                  <td className="text-xs text-ink-soft">{a.source}</td>
                  <td>
                    <form action={deleteCorporateAction} className="inline">
                      <input type="hidden" name="id" value={a.id} />
                      <button type="submit" className="text-ink-soft hover:text-loss text-xs">
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
