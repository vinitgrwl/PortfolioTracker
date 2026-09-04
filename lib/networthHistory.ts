import type { Transaction, ManualInstrument, CompanyEvent, Currency, Country, AssetClass } from "./types";
import { computeFDCurrentValue } from "./networth";
import { ForwardFiller } from "./historicalPrices";

interface HoldingMeta {
  key: string; // ISIN or ticker::currency — same identity rule as networth.ts
  ticker: string;
  isin: string | null;
  currency: Currency;
  country: Country;
  assetClass: AssetClass;
}

function holdingKey(t: Pick<Transaction, "isin" | "asset_ticker" | "currency">) {
  return t.isin && t.isin.trim() ? t.isin.trim() : `${t.asset_ticker}::${t.currency}`;
}

function currencyForCountry(country: Country): Currency {
  return country === "India" ? "INR" : "USD";
}

/**
 * Reconstructs total net worth (INR) for every date in `dates`, by
 * replaying the transaction ledger and instrument set day by day and
 * pricing each open position from its historical price series.
 *
 * MVP scope: this trends *current value* only (not invested value or
 * P&L) — that keeps the reconstruction to one pass over the ledger
 * instead of also tracking historical cost basis.
 *
 * Known approximations (documented, not silently hidden):
 *  - A holding with no resolvable historical price series (uncommon
 *    crypto, a mutual fund AMFI/mfapi.in couldn't match) contributes 0
 *    to every past date, same as it does to "today" until priced.
 *  - ULIPs have no historical value feed; every past date uses the
 *    invested amount flat, with the real current_value only applied on
 *    the most recent date.
 *  - Stock splits/bonus issues (corporate_actions) are NOT applied
 *    here — this trend can undercount a holding's quantity from its
 *    ex-date onward. Company events (renames/mergers) ARE applied: on
 *    the effective date, the old ticker's quantity transfers to the
 *    new ticker so this doesn't go flat/wrong after a merger.
 */
export function computeDailyNetWorthSeries(
  transactions: Transaction[],
  instruments: ManualInstrument[],
  dates: string[], // ascending "YYYY-MM-DD"
  priceSeriesByHolding: Map<string, ForwardFiller>,
  usdInrSeries: ForwardFiller,
  companyEvents: CompanyEvent[] = []
): { date: string; totalInr: number }[] {
  const sortedTxns = [...transactions].sort((a, b) => a.txn_date.localeCompare(b.txn_date));

  const holdingMeta = new Map<string, HoldingMeta>();
  for (const t of sortedTxns) {
    const key = holdingKey(t);
    if (!holdingMeta.has(key)) {
      holdingMeta.set(key, {
        key,
        ticker: t.asset_ticker,
        isin: t.isin,
        currency: t.currency,
        country: t.country,
        assetClass: t.asset_class,
      });
    }
  }

  // Company-event transfers: on effective_date, move whatever quantity is
  // still held under the old identity into the new one. The new identity
  // may never have appeared in the raw ledger (the user never personally
  // traded it before the merger), so its holdingMeta has to be seeded here
  // too — using the old holding's asset class, since a merger doesn't
  // change what kind of instrument it is.
  const transfers = [...companyEvents]
    .sort((a, b) => a.effective_date.localeCompare(b.effective_date))
    .map((ev) => {
      const fromCurrency = currencyForCountry(ev.old_country);
      const fromKey = ev.old_isin?.trim() ? ev.old_isin.trim() : `${ev.old_ticker}::${fromCurrency}`;
      const toCurrency = currencyForCountry(ev.new_country);
      const toKey = ev.new_isin?.trim() ? ev.new_isin.trim() : `${ev.new_ticker}::${toCurrency}`;
      const fromMeta = holdingMeta.get(fromKey);
      if (!holdingMeta.has(toKey)) {
        holdingMeta.set(toKey, {
          key: toKey,
          ticker: ev.new_ticker,
          isin: ev.new_isin,
          currency: toCurrency,
          country: ev.new_country,
          assetClass: fromMeta?.assetClass ?? "Stock",
        });
      }
      return { fromKey, toKey, factor: ev.ratio_to / ev.ratio_from, effectiveDate: ev.effective_date };
    });
  const transferApplied = new Set<number>();

  const qty = new Map<string, number>();
  let txnPointer = 0;

  const results: { date: string; totalInr: number }[] = [];
  const lastDate = dates[dates.length - 1];

  for (const date of dates) {
    // Apply every transaction dated on/before `date` that we haven't applied yet.
    while (txnPointer < sortedTxns.length && sortedTxns[txnPointer].txn_date <= date) {
      const t = sortedTxns[txnPointer];
      const key = holdingKey(t);
      const prev = qty.get(key) ?? 0;
      if (t.action === "buy") qty.set(key, prev + t.quantity);
      else if (t.action === "sell") qty.set(key, prev - t.quantity);
      // dividends don't change holding quantity (quantity=1 is a cash-amount convention there)
      txnPointer += 1;
    }

    // Apply any company-event transfers whose effective date has arrived.
    transfers.forEach((tr, i) => {
      if (transferApplied.has(i) || tr.effectiveDate > date) return;
      const moving = (qty.get(tr.fromKey) ?? 0) * tr.factor;
      qty.set(tr.toKey, (qty.get(tr.toKey) ?? 0) + moving);
      qty.set(tr.fromKey, 0);
      transferApplied.add(i);
    });

    let totalInr = 0;
    const usdInr = usdInrSeries.valueAt(date);

    for (const [key, q] of qty) {
      if (Math.abs(q) < 1e-9) continue;
      const meta = holdingMeta.get(key)!;
      const filler = priceSeriesByHolding.get(key);
      const nativePrice = filler?.valueAt(date);
      if (nativePrice === undefined) continue; // unresolved series — contributes 0, documented above

      const nativeValue = nativePrice * q;
      if (meta.currency === "USD") {
        if (usdInr === undefined) continue;
        totalInr += nativeValue * usdInr;
      } else {
        totalInr += nativeValue;
      }
    }

    for (const inst of instruments) {
      const inclusionDate = inst.start_date ?? inst.created_at.slice(0, 10);
      if (inclusionDate > date) continue;

      if (inst.asset_type === "FD") {
        if (!inst.start_date || inst.rate === null) {
          totalInr += toInr(inst.invested_amount, inst.currency, usdInr);
          continue;
        }
        const value = computeFDCurrentValue(
          inst.invested_amount,
          inst.rate,
          inst.start_date,
          inst.maturity_date,
          new Date(`${date}T00:00:00Z`)
        );
        totalInr += toInr(value, inst.currency, usdInr);
      } else {
        // ULIP — no historical feed; flat invested amount except on the final (today) point
        const value = date === lastDate ? inst.current_value ?? inst.invested_amount : inst.invested_amount;
        totalInr += toInr(value, inst.currency, usdInr);
      }
    }

    results.push({ date, totalInr });
  }

  return results;
}

function toInr(value: number, currency: Currency, usdInr: number | undefined): number {
  if (currency !== "USD") return value;
  return usdInr !== undefined ? value * usdInr : 0;
}

export { holdingKey };
