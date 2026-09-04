"use client";

import { useState } from "react";
import { addCompanyEvent, deleteCompanyEvent } from "@/lib/actions-company-events";
import type { CompanyEvent } from "@/lib/types";

export default function CompanyEventsManager({ events }: { events: CompanyEvent[] }) {
  const [showForm, setShowForm] = useState(false);
  const [eventType, setEventType] = useState<"rename" | "merger">("rename");
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <div className="px-3 py-3 border-b border-rule bg-paper flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-ink-soft">
          A company that changed its ticker (e.g. Zomato → Eternal) or was absorbed into another listed
          company (e.g. HDFC → HDFC Bank). Applied to holdings, realized P&amp;L, and price lookups from the
          effective date — your logged transactions themselves are never changed. For a straight buyout for
          cash (a company going private, like TWTR), just log a normal Sell at the price/date you received
          instead of an event here.
        </p>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="border border-rule px-3 py-1.5 text-xs text-ink-soft hover:text-ink shrink-0"
        >
          {showForm ? "Cancel" : "Log an event"}
        </button>
      </div>

      {error && <p className="px-3 py-2 text-xs text-loss border-b border-rule">{error}</p>}

      {showForm && (
        <form
          action={async (fd) => {
            setError(null);
            try {
              await addCompanyEvent(fd);
              setShowForm(false);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not save that event.");
            }
          }}
          className="px-3 py-3 border-b border-rule grid grid-cols-2 md:grid-cols-4 gap-2 items-end"
        >
          <label className="text-xs text-ink-soft">
            Type
            <select
              name="event_type"
              value={eventType}
              onChange={(e) => setEventType(e.target.value as "rename" | "merger")}
              className="input mt-1"
            >
              <option value="rename">Rename (same company)</option>
              <option value="merger">Merger (into another company)</option>
            </select>
          </label>
          <label className="text-xs text-ink-soft">
            Effective date
            <input name="effective_date" type="date" required className="input mt-1" />
          </label>
          <div />
          <div />

          <label className="text-xs text-ink-soft">
            Old ticker
            <input name="old_ticker" required className="input mt-1" placeholder="ZOMATO" />
          </label>
          <label className="text-xs text-ink-soft">
            Old ISIN (optional)
            <input name="old_isin" className="input mt-1" />
          </label>
          <label className="text-xs text-ink-soft">
            Old country
            <select name="old_country" required className="input mt-1">
              <option value="India">India</option>
              <option value="United States">United States</option>
            </select>
          </label>
          <div />

          <label className="text-xs text-ink-soft">
            New ticker
            <input name="new_ticker" required className="input mt-1" placeholder="ETERNAL" />
          </label>
          <label className="text-xs text-ink-soft">
            New ISIN (optional)
            <input name="new_isin" className="input mt-1" />
          </label>
          <label className="text-xs text-ink-soft">
            New country
            <select name="new_country" required className="input mt-1">
              <option value="India">India</option>
              <option value="United States">United States</option>
            </select>
          </label>
          <div />

          {eventType === "merger" && (
            <>
              <label className="text-xs text-ink-soft">
                Ratio — old shares
                <input name="ratio_from" type="number" step="any" required className="input mt-1" placeholder="25" />
              </label>
              <label className="text-xs text-ink-soft">
                → new shares
                <input name="ratio_to" type="number" step="any" required className="input mt-1" placeholder="42" />
              </label>
              <div className="col-span-2 text-xs text-ink-soft self-center">
                e.g. HDFC → HDFC Bank was 25 old shares for 42 new shares.
              </div>
            </>
          )}

          <div className="col-span-2 md:col-span-4">
            <button type="submit" className="bg-ink text-paper-raised text-sm px-5 py-2">
              Save event
            </button>
          </div>
        </form>
      )}

      {events.length > 0 && (
        <table className="ledger">
          <thead>
            <tr>
              <th>Type</th>
              <th>Old</th>
              <th>New</th>
              <th>Ratio</th>
              <th>Effective</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {events
              .slice()
              .sort((a, b) => b.effective_date.localeCompare(a.effective_date))
              .map((e) => (
                <tr key={e.id}>
                  <td className="capitalize">{e.event_type}</td>
                  <td>
                    {e.old_ticker} <span className="text-ink-soft">({e.old_country})</span>
                  </td>
                  <td>
                    {e.new_ticker} <span className="text-ink-soft">({e.new_country})</span>
                  </td>
                  <td>
                    {e.ratio_from}:{e.ratio_to}
                  </td>
                  <td className="whitespace-nowrap">{e.effective_date}</td>
                  <td>
                    <form action={deleteCompanyEvent}>
                      <input type="hidden" name="id" value={e.id} />
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
