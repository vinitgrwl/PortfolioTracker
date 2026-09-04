"use client";

import { useState, useTransition } from "react";
import {
  addCorporateAction,
  deleteCorporateAction,
  autoFetchCorporateActions,
  confirmPendingCorporateAction,
  dismissPendingCorporateAction,
} from "@/lib/actions-corp-actions";
import type { CorporateAction, PendingCorporateAction } from "@/lib/types";

export default function CorporateActionsManager({
  actions,
  pendingActions,
}: {
  actions: CorporateAction[];
  pendingActions: PendingCorporateAction[];
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  return (
    <div>
      <div className="px-3 py-3 border-b border-rule bg-paper flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-ink-soft">
          Splits and bonus issues, applied automatically to holdings and realized P&amp;L by date. US tickers
          auto-fetch reliably via Yahoo Finance. India tickers try NSE first, then Yahoo Finance as a
          fallback for splits only (bonus issues aren&apos;t on Yahoo), then Dhan as a third source — Dhan
          matches only ever land in &ldquo;Pending review&rdquo; below since its ratio direction isn&apos;t
          confirmed; everything else here applies straight away.
        </p>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await autoFetchCorporateActions();
                const indiaNote = res.indiaAttempted
                  ? ` India: NSE found ${res.indiaFound}${
                      res.indiaFallbackUsed > 0
                        ? `, Yahoo fallback caught ${res.indiaFallbackUsed} more split(s) NSE missed`
                        : ""
                    }.`
                  : "";
                const dhanNote =
                  res.dhanChecked > 0 ? ` Dhan staged ${res.dhanStaged} new match(es) for review.` : "";
                setResult(`Checked ${res.checked} securities, added ${res.added} new action(s).${indiaNote}${dhanNote}`);
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

      {pendingActions.length > 0 && (
        <div className="border-b border-rule">
          <h3 className="text-xs text-ink-soft px-3 pt-3">
            Pending review — from Dhan, ratio not yet confirmed
          </h3>
          <table className="ledger">
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Type</th>
                <th>Ex-date</th>
                <th>Raw note</th>
                <th>Ratio (edit if needed)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pendingActions
                .slice()
                .sort((a, b) => b.ex_date.localeCompare(a.ex_date))
                .map((p) => (
                  <tr key={p.id}>
                    <td>{p.asset_ticker}</td>
                    <td className="capitalize">{p.action_type}</td>
                    <td className="whitespace-nowrap">{p.ex_date}</td>
                    <td className="text-xs text-ink-soft">{p.raw_note}</td>
                    <td>
                      <form action={confirmPendingCorporateAction} className="flex items-center gap-1">
                        <input type="hidden" name="pending_id" value={p.id} />
                        <input type="hidden" name="asset_ticker" value={p.asset_ticker} />
                        <input type="hidden" name="isin" value={p.isin ?? ""} />
                        <input type="hidden" name="country" value={p.country} />
                        <input type="hidden" name="action_type" value={p.action_type} />
                        <input type="hidden" name="ex_date" value={p.ex_date} />
                        <input
                          name="ratio_from"
                          type="number"
                          step="any"
                          required
                          defaultValue={p.parsed_ratio_from ?? undefined}
                          className="input w-16"
                        />
                        <span className="text-ink-soft">:</span>
                        <input
                          name="ratio_to"
                          type="number"
                          step="any"
                          required
                          defaultValue={p.parsed_ratio_to ?? undefined}
                          className="input w-16"
                        />
                        <button
                          type="submit"
                          className="border border-rule px-2 py-1 text-xs text-ink-soft hover:text-gain hover:border-gain"
                        >
                          Confirm
                        </button>
                      </form>
                    </td>
                    <td>
                      <form action={dismissPendingCorporateAction}>
                        <input type="hidden" name="id" value={p.id} />
                        <button type="submit" className="text-ink-soft hover:text-loss text-xs">
                          Dismiss
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
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
