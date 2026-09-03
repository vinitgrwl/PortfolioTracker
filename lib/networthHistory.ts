import type { Transaction, ManualInstrument, Currency, Country, AssetClass } from "./types";
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
 */
export function computeDailyNetWorthSeries(
  transactions: Transaction[],
  instruments: ManualInstrument[],
  dates: string[], // ascending "YYYY-MM-DD"
  priceSeriesByHolding: Map<string, ForwardFiller>,
  usdInrSeries: ForwardFiller
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
