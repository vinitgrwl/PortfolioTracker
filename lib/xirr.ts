import type { Transaction, ManualInstrument, Currency } from "./types";
import type { Holding } from "./networth";
import { instrumentCurrentValue } from "./networth";

export interface CashFlow {
  date: Date;
  amount: number; // negative = money out, positive = money in
}

/**
 * Solves for the annualized rate r such that the NPV of all cash flows
 * (discounted from the earliest flow's date) is zero — the standard XIRR
 * definition. Newton-Raphson first, falls back to bisection over a wide
 * range if Newton doesn't converge (common with clustered/lumpy flows).
 */
export function computeXirr(cashflows: CashFlow[]): number | null {
  if (cashflows.length < 2) return null;
  const sorted = [...cashflows].sort((a, b) => a.date.getTime() - b.date.getTime());

  const hasPositive = sorted.some((c) => c.amount > 0);
  const hasNegative = sorted.some((c) => c.amount < 0);
  if (!hasPositive || !hasNegative) return null; // no sign change — no solvable rate

  const t0 = sorted[0].date.getTime();
  const years = sorted.map((cf) => (cf.date.getTime() - t0) / (365 * 24 * 60 * 60 * 1000));
  const values = sorted.map((cf) => cf.amount);

  const npv = (rate: number) => values.reduce((sum, v, i) => sum + v / Math.pow(1 + rate, years[i]), 0);
  const dnpv = (rate: number) =>
    values.reduce((sum, v, i) => sum - (years[i] * v) / Math.pow(1 + rate, years[i] + 1), 0);

  let rate = 0.15;
  for (let i = 0; i < 100; i++) {
    const f = npv(rate);
    const df = dnpv(rate);
    if (Math.abs(df) < 1e-10) break;
    const next = rate - f / df;
    if (!Number.isFinite(next) || next <= -0.999) break;
    if (Math.abs(next - rate) < 1e-7) {
      rate = next;
      break;
    }
    rate = next;
  }
  if (Number.isFinite(rate) && rate > -0.999 && Math.abs(npv(rate)) < Math.max(1, Math.abs(values[0]) * 1e-6)) {
    return rate;
  }

  // Bisection fallback
  let lo = -0.9999;
  let hi = 10;
  let fLo = npv(lo);
  const fHi = npv(hi);
  if (Math.sign(fLo) === Math.sign(fHi)) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-6) return mid;
    if (Math.sign(fMid) === Math.sign(fLo)) {
      lo = mid;
      fLo = fMid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

/**
 * Builds buy/sell/dividend/instrument cash flows for the given
 * transactions/instruments/holdings, split by native currency (INR and
 * USD kept separate — there's no historical FX rate stored per
 * transaction, so blending them into one figure would be a fake-precise
 * number). Pass already-filtered transactions/instruments/holdings to
 * scope this to one member; pass everything for the family total.
 */
export function buildCashflowsByCurrency(
  transactions: Transaction[],
  instruments: ManualInstrument[],
  holdings: Holding[],
  asOf: Date = new Date()
): Record<Currency, CashFlow[]> {
  const byCurrency: Record<Currency, CashFlow[]> = { INR: [], USD: [] };

  for (const t of transactions) {
    const list = byCurrency[t.currency];
    if (t.action === "buy") {
      list.push({ date: new Date(t.txn_date), amount: -(t.quantity * t.price + t.fiat_fees) });
    } else if (t.action === "sell") {
      list.push({ date: new Date(t.txn_date), amount: t.quantity * t.price - t.fiat_fees });
    } else if (t.action === "dividend") {
      list.push({ date: new Date(t.txn_date), amount: t.price }); // convention: price = total cash amount
    }
  }

  for (const h of holdings) {
    if (h.currentValue !== null) {
      byCurrency[h.currency].push({ date: asOf, amount: h.currentValue });
    }
  }

  for (const inst of instruments) {
    const inclusionDate = inst.start_date ?? inst.created_at.slice(0, 10);
    byCurrency[inst.currency].push({ date: new Date(inclusionDate), amount: -inst.invested_amount });
    byCurrency[inst.currency].push({ date: asOf, amount: instrumentCurrentValue(inst, asOf) });
  }

  return byCurrency;
}
