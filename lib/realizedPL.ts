import type { Transaction, CorporateAction, Currency } from "./types";
import { replayLots, fyLabel, type RealizedTrade, type GainClassification } from "./lots";

export type { RealizedTrade, GainClassification };
export { fyLabel };

/**
 * Realized (sold) trades via FIFO lot matching, corporate-action aware —
 * see lib/lots.ts for the actual replay (shared with holdings so the
 * two pages can never disagree on quantities after a split/bonus).
 */
export function computeRealizedPL(
  transactions: Transaction[],
  corporateActions: CorporateAction[] = []
): RealizedTrade[] {
  return replayLots(transactions, corporateActions).realizedTrades;
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
