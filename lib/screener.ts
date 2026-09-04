import type { Transaction, Member, Currency, Country, AssetClass } from "./types";
import type { Holding } from "./networth";
import { toINR } from "./networth";
import type { RealizedTrade } from "./lots";

export interface ScreenerOption {
  key: string; // ISIN or ticker::currency
  ticker: string;
  assetName: string | null;
  currency: Currency;
  country: Country;
}

/** Every distinct security ever transacted — the picker's option list. */
export function listScreenerOptions(transactions: Transaction[]): ScreenerOption[] {
  const byKey = new Map<string, ScreenerOption>();
  for (const t of transactions) {
    const key = t.isin && t.isin.trim() ? t.isin.trim() : `${t.asset_ticker}::${t.currency}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { key, ticker: t.asset_ticker, assetName: t.asset_name, currency: t.currency, country: t.country });
    } else if (!existing.assetName && t.asset_name) {
      existing.assetName = t.asset_name;
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.ticker.localeCompare(b.ticker));
}

export interface PlatformHolding {
  memberId: string;
  memberName: string;
  platform: string;
  quantity: number; // net buys minus sells on that platform — not FIFO, just a net count
}

export interface ScreenerSummary {
  key: string;
  ticker: string;
  assetName: string | null;
  isin: string | null;
  currency: Currency;
  country: Country;
  assetClass: AssetClass;
  quantity: number; // total currently held, across every member
  investedINR: number;
  currentPriceNative: number | null;
  currentINR: number | null;
  unrealizedPLINR: number | null;
  unrealizedROIPct: number | null;
  realizedPLINR: number;
  dividendINR: number;
  totalPLINR: number | null;
  byPlatform: PlatformHolding[];
  trades: Transaction[]; // every buy/sell/dividend row for this security, newest first
}

export function computeScreenerSummary(
  key: string,
  holdings: Holding[],
  realizedTrades: RealizedTrade[],
  transactions: Transaction[],
  members: Member[],
  usdInrRate: number
): ScreenerSummary | null {
  const matchingHoldings = holdings.filter((h) => h.key === key);
  const matchingTxns = transactions.filter((t) => {
    const tKey = t.isin && t.isin.trim() ? t.isin.trim() : `${t.asset_ticker}::${t.currency}`;
    return tKey === key;
  });
  if (matchingHoldings.length === 0 && matchingTxns.length === 0) return null;

  const first = matchingHoldings[0] ?? null;
  const anyTxn = matchingTxns[0];

  const ticker = first?.assetTicker ?? anyTxn.asset_ticker;
  const currency = first?.currency ?? anyTxn.currency;
  const country = first?.country ?? anyTxn.country;
  const assetClass = first?.assetClass ?? anyTxn.asset_class;
  const isin = first?.isin ?? anyTxn.isin;
  const assetName = matchingTxns.find((t) => t.asset_name)?.asset_name ?? first?.assetName ?? null;

  let quantity = 0;
  let investedINR = 0;
  let currentINR = 0;
  let hasAllPrices = matchingHoldings.length > 0;
  for (const h of matchingHoldings) {
    quantity += h.quantity;
    investedINR += toINR(h.investedValue, h.currency, usdInrRate);
    if (h.currentValue === null) {
      hasAllPrices = false;
    } else {
      currentINR += toINR(h.currentValue, h.currency, usdInrRate);
    }
  }
  const currentPriceNative = matchingHoldings.find((h) => h.currentPrice !== null)?.currentPrice ?? null;

  const unrealizedPLINR = hasAllPrices ? currentINR - investedINR : null;
  const unrealizedROIPct = hasAllPrices && investedINR > 0 ? (unrealizedPLINR! / investedINR) * 100 : null;

  const realizedPLINR = realizedTrades
    .filter((r) => r.key === key)
    .reduce((sum, r) => sum + toINR(r.gainNative, r.currency, usdInrRate), 0);

  const dividendINR = matchingTxns
    .filter((t) => t.action === "dividend")
    .reduce((sum, t) => sum + toINR(t.price, t.currency, usdInrRate), 0);

  const totalPLINR = unrealizedPLINR !== null ? unrealizedPLINR + realizedPLINR + dividendINR : null;

  // Per (member, platform) net quantity — a simple running total, not a
  // FIFO lot replay, since this is just "where do these shares sit".
  const memberById = new Map(members.map((m) => [m.id, m.name]));
  const platformQty = new Map<string, PlatformHolding>();
  for (const t of matchingTxns) {
    if (t.action === "dividend") continue;
    const pKey = `${t.member_id}::${t.platform}`;
    const existing = platformQty.get(pKey) ?? {
      memberId: t.member_id,
      memberName: memberById.get(t.member_id) ?? "—",
      platform: t.platform,
      quantity: 0,
    };
    existing.quantity += t.action === "buy" ? t.quantity : -t.quantity;
    platformQty.set(pKey, existing);
  }
  const byPlatform = Array.from(platformQty.values())
    .filter((p) => Math.abs(p.quantity) > 1e-9)
    .sort((a, b) => b.quantity - a.quantity);

  const trades = [...matchingTxns].sort((a, b) => (a.txn_date < b.txn_date ? 1 : a.txn_date > b.txn_date ? -1 : 0));

  return {
    key,
    ticker,
    assetName,
    isin,
    currency,
    country,
    assetClass,
    quantity,
    investedINR,
    currentPriceNative,
    currentINR: hasAllPrices ? currentINR : null,
    unrealizedPLINR,
    unrealizedROIPct,
    realizedPLINR,
    dividendINR,
    totalPLINR,
    byPlatform,
    trades,
  };
}
