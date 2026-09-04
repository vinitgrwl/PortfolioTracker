import type { Holding } from "./networth";
import { toINR, instrumentCurrentValue } from "./networth";
import type {
  ManualInstrument,
  AssetClassTarget,
  TickerTarget,
  RebalanceAssetClass,
  AssetClass,
} from "./types";

const TOLERANCE_PP = 1; // percentage points — within this band counts as "On Target"

export type RebalanceStatus = "Overweight" | "Underweight" | "On Target" | "No Target";

export interface ClassRebalanceRow {
  assetClass: RebalanceAssetClass;
  currentINR: number;
  actualPct: number; // % of total portfolio
  targetPct: number | null;
  deltaPct: number | null;
  status: RebalanceStatus;
}

export interface TickerRebalanceRow {
  assetClass: AssetClass;
  assetTicker: string;
  currentINR: number;
  actualPct: number; // % of that class's value
  targetPct: number | null;
  deltaPct: number | null;
  status: RebalanceStatus;
}

export type NextPurchase =
  | { level: "ticker"; assetClass: string; assetTicker: string; deltaPct: number }
  | { level: "class"; assetClass: string; deltaPct: number }
  | null;

export interface RebalancingResult {
  totalINR: number;
  classes: ClassRebalanceRow[];
  tickersByClass: Record<string, TickerRebalanceRow[]>;
  nextPurchase: NextPurchase;
}

function statusFor(delta: number | null): RebalanceStatus {
  if (delta === null) return "No Target";
  if (delta > TOLERANCE_PP) return "Overweight";
  if (delta < -TOLERANCE_PP) return "Underweight";
  return "On Target";
}

/**
 * @param memberId  Pass a specific member's id to scope the whole computation
 *                  to just their holdings/instruments, or null for the
 *                  family-wide combined view. Targets themselves are the
 *                  same set either way — only "actual" changes.
 */
export function computeRebalancing(
  holdings: Holding[],
  instruments: ManualInstrument[],
  classTargets: AssetClassTarget[],
  tickerTargets: TickerTarget[],
  usdInrRate: number,
  memberId: string | null,
  asOf: Date = new Date()
): RebalancingResult {
  const scopedHoldings = memberId ? holdings.filter((h) => h.memberId === memberId) : holdings;
  const scopedInstruments = memberId ? instruments.filter((i) => i.member_id === memberId) : instruments;

  // ---- class-level current values ----
  const classValueINR = new Map<RebalanceAssetClass, number>();
  const bumpClass = (cls: RebalanceAssetClass, v: number) =>
    classValueINR.set(cls, (classValueINR.get(cls) ?? 0) + v);

  for (const h of scopedHoldings) {
    if (h.currentValue === null) continue; // no price yet — excluded from current-value weighting
    bumpClass(h.assetClass, toINR(h.currentValue, h.currency, usdInrRate));
  }
  for (const inst of scopedInstruments) {
    bumpClass(inst.asset_type, toINR(instrumentCurrentValue(inst, asOf), inst.currency, usdInrRate));
  }

  const totalINR = Array.from(classValueINR.values()).reduce((a, b) => a + b, 0);

  const targetByClass = new Map<RebalanceAssetClass, number>();
  for (const t of classTargets) targetByClass.set(t.asset_class, t.target_weight_pct);

  const allClasses: RebalanceAssetClass[] = ["Stock", "ETF", "Crypto", "Mutual Fund", "FD", "ULIP"];
  const classes: ClassRebalanceRow[] = allClasses
    .map((cls) => {
      const currentINR = classValueINR.get(cls) ?? 0;
      const targetPct = targetByClass.get(cls) ?? null;
      if (currentINR === 0 && targetPct === null) return null; // nothing to show
      const actualPct = totalINR > 0 ? (currentINR / totalINR) * 100 : 0;
      const deltaPct = targetPct !== null ? actualPct - targetPct : null;
      return { assetClass: cls, currentINR, actualPct, targetPct, deltaPct, status: statusFor(deltaPct) };
    })
    .filter((r): r is ClassRebalanceRow => r !== null);

  // ---- ticker-level current values, within each holding-based class ----
  const tickerClasses: AssetClass[] = ["Stock", "ETF", "Crypto", "Mutual Fund"];
  const tickerValueINR = new Map<string, number>(); // `${class}::${ticker}` -> INR

  for (const h of scopedHoldings) {
    if (h.currentValue === null) continue;
    const key = `${h.assetClass}::${h.assetTicker}`;
    tickerValueINR.set(key, (tickerValueINR.get(key) ?? 0) + toINR(h.currentValue, h.currency, usdInrRate));
  }

  const targetByTicker = new Map<string, number>();
  for (const t of tickerTargets) targetByTicker.set(`${t.asset_class}::${t.asset_ticker}`, t.target_weight_pct);

  const tickersByClass: Record<string, TickerRebalanceRow[]> = {};

  for (const cls of tickerClasses) {
    const classTotalINR = classValueINR.get(cls) ?? 0;
    const tickersInClass = new Set<string>();
    for (const key of tickerValueINR.keys()) {
      if (key.startsWith(`${cls}::`)) tickersInClass.add(key.slice(cls.length + 2));
    }
    for (const t of tickerTargets) {
      if (t.asset_class === cls) tickersInClass.add(t.asset_ticker);
    }

    const rows: TickerRebalanceRow[] = Array.from(tickersInClass)
      .map((ticker) => {
        const currentINR = tickerValueINR.get(`${cls}::${ticker}`) ?? 0;
        const targetPct = targetByTicker.get(`${cls}::${ticker}`) ?? null;
        if (currentINR === 0 && targetPct === null) return null;
        const actualPct = classTotalINR > 0 ? (currentINR / classTotalINR) * 100 : 0;
        const deltaPct = targetPct !== null ? actualPct - targetPct : null;
        return {
          assetClass: cls,
          assetTicker: ticker,
          currentINR,
          actualPct,
          targetPct,
          deltaPct,
          status: statusFor(deltaPct),
        };
      })
      .filter((r): r is TickerRebalanceRow => r !== null)
      .sort((a, b) => b.currentINR - a.currentINR);

    if (rows.length > 0) tickersByClass[cls] = rows;
  }

  // ---- next purchase recommended: most-underweight ticker with a target,
  // falling back to the most-underweight class if no ticker targets exist ----
  let nextPurchase: NextPurchase = null;
  let worstTickerDelta = Infinity;
  for (const rows of Object.values(tickersByClass)) {
    for (const r of rows) {
      if (r.deltaPct !== null && r.deltaPct < -TOLERANCE_PP && r.deltaPct < worstTickerDelta) {
        worstTickerDelta = r.deltaPct;
        nextPurchase = { level: "ticker", assetClass: r.assetClass, assetTicker: r.assetTicker, deltaPct: r.deltaPct };
      }
    }
  }
  if (!nextPurchase) {
    let worstClassDelta = Infinity;
    for (const c of classes) {
      if (c.deltaPct !== null && c.deltaPct < -TOLERANCE_PP && c.deltaPct < worstClassDelta) {
        worstClassDelta = c.deltaPct;
        nextPurchase = { level: "class", assetClass: c.assetClass, deltaPct: c.deltaPct };
      }
    }
  }

  return { totalINR, classes, tickersByClass, nextPurchase };
}
