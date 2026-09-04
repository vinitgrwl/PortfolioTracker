"use client";

import { useState } from "react";
import { addCompanyEvent } from "@/lib/actions-company-events";
import type { Country, Currency } from "@/lib/types";

interface MissingEntry {
  asset_ticker: string;
  isin: string | null;
  country: Country;
  currency: Currency;
}

export default function MissingPricesList({ missing }: { missing: MissingEntry[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  return (
    <div className="px-3 py-3">
      <p className="text-xs text-ink-soft mb-2">
        These holdings don&rsquo;t have a current price yet — the dashboard counts their invested value but
        not their current value. If one of these renamed, merged into another company, or went private,
        click it to log that instead of tracking down a price for a symbol that no longer exists.
      </p>
      <ul className="flex flex-wrap gap-2">
        {missing.map((t) => {
          const key = `${t.asset_ticker}::${t.currency}`;
          const isOpen = openKey === key;
          return (
            <li key={key} className="w-full sm:w-auto">
              <button
                type="button"
                onClick={() => setOpenKey(isOpen ? null : key)}
                className={`text-xs border px-2 py-1 ${
                  isOpen ? "border-ink bg-paper" : "border-rule bg-white hover:border-ink"
                }`}
              >
                {t.asset_ticker} ({t.currency})
              </button>
              {isOpen && <MiniEventForm entry={t} onDone={() => setOpenKey(null)} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function MiniEventForm({ entry, onDone }: { entry: MissingEntry; onDone: () => void }) {
  const [eventType, setEventType] = useState<"rename" | "merger">("rename");

  return (
    <form
      action={async (fd) => {
        await addCompanyEvent(fd);
        onDone();
      }}
      className="mt-2 p-3 border border-rule bg-paper-raised flex flex-wrap gap-2 items-end max-w-md"
    >
      <input type="hidden" name="old_ticker" value={entry.asset_ticker} />
      <input type="hidden" name="old_isin" value={entry.isin ?? ""} />
      <input type="hidden" name="old_country" value={entry.country} />

      <label className="text-xs text-ink-soft">
        Type
        <select
          name="event_type"
          value={eventType}
          onChange={(e) => setEventType(e.target.value as "rename" | "merger")}
          className="input mt-1"
        >
          <option value="rename">Rename</option>
          <option value="merger">Merger</option>
        </select>
      </label>
      <label className="text-xs text-ink-soft">
        New ticker
        <input name="new_ticker" required className="input mt-1 w-28" />
      </label>
      <label className="text-xs text-ink-soft">
        New country
        <select name="new_country" defaultValue={entry.country} required className="input mt-1">
          <option value="India">India</option>
          <option value="United States">United States</option>
        </select>
      </label>
      <label className="text-xs text-ink-soft">
        Effective date
        <input name="effective_date" type="date" required className="input mt-1" />
      </label>

      {eventType === "merger" && (
        <>
          <label className="text-xs text-ink-soft">
            Old shares
            <input name="ratio_from" type="number" step="any" required className="input mt-1 w-16" placeholder="25" />
          </label>
          <label className="text-xs text-ink-soft">
            → New shares
            <input name="ratio_to" type="number" step="any" required className="input mt-1 w-16" placeholder="42" />
          </label>
        </>
      )}

      <div className="w-full text-xs text-ink-soft">
        For a buyout for cash (company went private), don&rsquo;t log an event here — go log a normal Sell
        transaction instead.
      </div>

      <button type="submit" className="bg-ink text-paper-raised text-sm px-4 py-1.5">
        Save
      </button>
      <button type="button" onClick={onDone} className="text-xs text-ink-soft hover:text-ink">
        Cancel
      </button>
    </form>
  );
}
