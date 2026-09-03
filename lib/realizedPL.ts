import type { Transaction, Currency, Country, AssetClass } from "./types";

export type GainClassification = "STCG" | "LTCG" | "VDA";

export interface RealizedTrade {
  memberId: string;
  key: string; // ISIN or ticker::currency — same identity rule as the rest of the app
  ticker: string;
  isin: string | null;
  currency: Currency;
  country: Country;
  assetClass: AssetClass;
  sellDate: string;
  buyDate: string;
  quantity: number;
  proceedsNative: number;
  costBasisNative: number;
  gainNative: number;
  holdingDays: number;
  classification: GainClassification;
  fy: string; // "FY2024-25"
}

/** Indian financial year (Apr 1 – Mar 31) label for a YYYY-MM-DD date. */
export function fyLabel(dateStr: string): string {
  const [y, m] = dateStr.split("-").map(Number);
  const startYear = m >= 4 ? y : y - 1;
  return `FY${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

function holdingKey(t: Pick<Transaction, "isin" | "asset_ticker" | "currency">) {
  return t.isin && t.isin.trim() ? t.isin.trim() : `${t.asset_ticker}::${t.currency}`;
}

/**
 * India capital-gains classification (general rules — not tax advice,
 * and doesn't distinguish equity vs debt mutual funds since that isn't
 * tracked; debt funds actually have no LTCG concept post the 2023
 * amendment and are always short-term regardless of holding period):
 *  - Crypto/VDA: flat 30% either way, no STCG/LTCG split, shown separately.
 *  - Listed Indian equity/ETF/Mutual Fund: LTCG if held > 12 months.
 *  - Foreign shares (US stocks): LTCG if held > 24 months.
 */
function classify(assetClass: AssetClass, country: Country, holdingDays: number): GainClassification {
  if (assetClass === "Crypto") return "VDA";
  const longTermThresholdDays = assetClass !== "Mutual Fund" && country === "United States" ? 730 : 365;
  return holdingDays > longTermThresholdDays ? "LTCG" : "STCG";
}

interface Lot {
  date: string;
  qty: number;
  costPerUnit: number;
}

/**
 * Replays the transaction ledger per (member, holding) using FIFO lot
 * matching. Each sell can consume multiple lots with different purchase
 * dates — every lot portion consumed becomes its own RealizedTrade entry,
 * classified by its own holding period (this is how it actually has to
 * work for STCG/LTCG splitting, not just once per sell transaction).
 */
export function computeRealizedPL(transactions: Transaction[]): RealizedTrade[] {
  const sorted = [...transactions].sort((a, b) => a.txn_date.localeCompare(b.txn_date));

  const lotsByGroup = new Map<string, Lot[]>();
  const results: RealizedTrade[] = [];

  for (const t of sorted) {
    if (t.action === "dividend") continue;
    const groupKey = `${t.member_id}::${holdingKey(t)}`;
    if (!lotsByGroup.has(groupKey)) lotsByGroup.set(groupKey, []);
    const queue = lotsByGroup.get(groupKey)!;

    if (t.action === "buy") {
      const costPerUnit = t.quantity > 0 ? (t.quantity * t.price + t.fiat_fees) / t.quantity : 0;
      queue.push({ date: t.txn_date, qty: t.quantity, costPerUnit });
      continue;
    }

    // sell
    let remaining = t.quantity;
    const proceedsPerUnit = t.quantity > 0 ? (t.quantity * t.price - t.fiat_fees) / t.quantity : 0;

    while (remaining > 1e-9 && queue.length > 0) {
      const lot = queue[0];
      const consumeQty = Math.min(remaining, lot.qty);
      const holdingDays = Math.round(
        (new Date(`${t.txn_date}T00:00:00Z`).getTime() - new Date(`${lot.date}T00:00:00Z`).getTime()) /
          (24 * 60 * 60 * 1000)
      );
      const classification = classify(t.asset_class, t.country, holdingDays);

      results.push({
        memberId: t.member_id,
        key: holdingKey(t),
        ticker: t.asset_ticker,
        isin: t.isin,
        currency: t.currency,
        country: t.country,
        assetClass: t.asset_class,
        sellDate: t.txn_date,
        buyDate: lot.date,
        quantity: consumeQty,
        proceedsNative: consumeQty * proceedsPerUnit,
        costBasisNative: consumeQty * lot.costPerUnit,
        gainNative: consumeQty * (proceedsPerUnit - lot.costPerUnit),
        holdingDays,
        classification,
        fy: fyLabel(t.txn_date),
      });

      lot.qty -= consumeQty;
      remaining -= consumeQty;
      if (lot.qty <= 1e-9) queue.shift();
    }
    // remaining > 0 here means a sell exceeded recorded holdings (data gap) — silently
    // ignored rather than guessing a cost basis for shares we have no purchase record of.
  }

  return results;
}

export interface RealizedSummaryRow {
  fy: string;
  memberId: string;
  currency: Currency;
  stcg: number;
  ltcg: number;
  vda: number;
}

export function summarizeRealizedPL(trades: RealizedTrade[]): RealizedSummaryRow[] {
  const map = new Map<string, RealizedSummaryRow>();
  for (const t of trades) {
    const key = `${t.fy}::${t.memberId}::${t.currency}`;
    if (!map.has(key)) map.set(key, { fy: t.fy, memberId: t.memberId, currency: t.currency, stcg: 0, ltcg: 0, vda: 0 });
    const row = map.get(key)!;
    if (t.classification === "STCG") row.stcg += t.gainNative;
    else if (t.classification === "LTCG") row.ltcg += t.gainNative;
    else row.vda += t.gainNative;
  }
  return Array.from(map.values()).sort((a, b) => b.fy.localeCompare(a.fy));
}

export interface DividendSummaryRow {
  fy: string;
  memberId: string;
  currency: Currency;
  total: number;
}

/** Dividends aren't capital gains (India: taxed as Income from Other Sources) — summarized separately. */
export function summarizeDividends(transactions: Transaction[]): DividendSummaryRow[] {
  const map = new Map<string, DividendSummaryRow>();
  for (const t of transactions) {
    if (t.action !== "dividend") continue;
    const fy = fyLabel(t.txn_date);
    const key = `${fy}::${t.member_id}::${t.currency}`;
    if (!map.has(key)) map.set(key, { fy, memberId: t.member_id, currency: t.currency, total: 0 });
    map.get(key)!.total += t.price; // convention: price = total cash amount for dividend rows
  }
  return Array.from(map.values()).sort((a, b) => b.fy.localeCompare(a.fy));
}
