import type { Holding } from "./networth";
import { toINR } from "./networth";

export interface SectorRow {
  sector: string; // "Unclassified" when no transaction in the group was tagged
  investedINR: number;
  currentINR: number;
  unrealizedINR: number;
  dividendINR: number;
  pctOfHoldings: number; // % of total holdings current value (Stock/ETF/Crypto/MF only — FD/ULIP have no sector)
}

export function computeSectorWise(holdings: Holding[], usdInrRate: number): SectorRow[] {
  const bySector = new Map<string, { investedINR: number; currentINR: number; dividendINR: number }>();

  for (const h of holdings) {
    const sector = h.sector && h.sector.trim() ? h.sector.trim() : "Unclassified";
    const investedINR = toINR(h.investedValue, h.currency, usdInrRate);
    const currentINR = h.currentValue !== null ? toINR(h.currentValue, h.currency, usdInrRate) : 0;
    const dividendINR = toINR(h.dividendTotal, h.currency, usdInrRate);

    const existing = bySector.get(sector) ?? { investedINR: 0, currentINR: 0, dividendINR: 0 };
    existing.investedINR += investedINR;
    existing.currentINR += currentINR;
    existing.dividendINR += dividendINR;
    bySector.set(sector, existing);
  }

  const totalCurrentINR = Array.from(bySector.values()).reduce((sum, v) => sum + v.currentINR, 0);

  return Array.from(bySector.entries())
    .map(([sector, v]) => ({
      sector,
      investedINR: v.investedINR,
      currentINR: v.currentINR,
      unrealizedINR: v.currentINR - v.investedINR,
      dividendINR: v.dividendINR,
      pctOfHoldings: totalCurrentINR > 0 ? (v.currentINR / totalCurrentINR) * 100 : 0,
    }))
    .sort((a, b) => b.currentINR - a.currentINR);
}
