import type {
  Transaction,
  ManualInstrument,
  LatestPrice,
  CorporateAction,
  Currency,
  Country,
  AssetClass,
} from "./types";
import { replayLots, holdingKey } from "./lots";
import { securityKeyFromCurrency } from "./identity";

// -----------------------------------------------------------------------
// Holdings — derived from the Transactions ledger via the shared FIFO
// lot replay in lib/lots.ts (so a split/bonus applied there is reflected
// here automatically, and can never disagree with the Realized P&L page).
// Identity: ISIN when present, else ticker+currency (so the same symbol
// in two currencies never collapses into one row).
// -----------------------------------------------------------------------

export interface Holding {
  memberId: string;
  key: string; // ISIN or ticker::currency
  assetTicker: string;
  assetName: string | null;
  isin: string | null;
  currency: Currency;
  country: Country;
  assetClass: AssetClass;
  quantity: number;
  avgCost: number; // native currency, per unit
  investedValue: number; // native currency
  currentPrice: number | null; // native currency, null = not entered yet
  currentValue: number | null; // native currency
  dividendTotal: number; // native currency, informational only
  sector: string | null;
}

function holdingKeyFor(t: Pick<Transaction, "isin" | "asset_ticker" | "currency" | "country">) {
  return holdingKey(t);
}

function priceKey(p: Pick<LatestPrice, "isin" | "asset_ticker" | "currency">) {
  return securityKeyFromCurrency(p.isin, p.asset_ticker, p.currency);
}

export function computeHoldings(
  transactions: Transaction[],
  prices: LatestPrice[],
  corporateActions: CorporateAction[] = []
): Holding[] {
  const priceByKey = new Map<string, number>();
  for (const p of prices) priceByKey.set(priceKey(p), p.current_price);

  type Meta = {
    memberId: string;
    key: string;
    assetTicker: string;
    assetName: string | null;
    isin: string | null;
    currency: Currency;
    country: Country;
    assetClass: AssetClass;
    dividendTotal: number;
    sector: string | null;
  };

  const metaByGroup = new Map<string, Meta>();

  for (const t of transactions) {
    const key = holdingKeyFor(t);
    const groupKey = `${t.member_id}::${key}`;

    if (!metaByGroup.has(groupKey)) {
      metaByGroup.set(groupKey, {
        memberId: t.member_id,
        key,
        assetTicker: t.asset_ticker,
        assetName: t.asset_name,
        isin: t.isin,
        currency: t.currency,
        country: t.country,
        assetClass: t.asset_class,
        dividendTotal: 0,
        sector: t.sector,
      });
    }

    const meta = metaByGroup.get(groupKey)!;
    if (!meta.assetName && t.asset_name) meta.assetName = t.asset_name;
    if (!meta.sector && t.sector) meta.sector = t.sector;

    if (t.action === "dividend") {
      // convention: quantity = 1, price = total cash amount
      meta.dividendTotal += t.quantity * t.price;
    }
  }

  const { lotsByGroup } = replayLots(transactions, corporateActions);
  const holdings: Holding[] = [];

  for (const [groupKey, meta] of metaByGroup) {
    const lots = lotsByGroup.get(groupKey) ?? [];
    const quantity = lots.reduce((sum, l) => sum + l.qty, 0);
    const investedValue = lots.reduce((sum, l) => sum + l.qty * l.costPerUnit, 0);
    const avgCost = quantity > 1e-9 ? investedValue / quantity : 0;

    // skip fully-exited positions (quantity ~0) — nothing left to hold
    if (quantity < 1e-9) continue;

    const currentPrice = priceByKey.get(meta.key) ?? null;
    const currentValue = currentPrice !== null ? currentPrice * quantity : null;

    holdings.push({
      memberId: meta.memberId,
      key: meta.key,
      assetTicker: meta.assetTicker,
      assetName: meta.assetName,
      isin: meta.isin,
      currency: meta.currency,
      country: meta.country,
      assetClass: meta.assetClass,
      quantity,
      avgCost,
      investedValue,
      currentPrice,
      currentValue,
      dividendTotal: meta.dividendTotal,
      sector: meta.sector,
    });
  }

  return holdings;
}

// -----------------------------------------------------------------------
// FD current value — compound interest, quarterly compounding
// (standard bank FD formula, agreed in the blueprint):
//   value = principal * (1 + r/4)^(4*t)
// t is capped at the FD's own tenure — once matured, value holds flat
// at the maturity value unless the user records a fresh FD (a renewal
// is a new instrument, not an extension of this one).
// -----------------------------------------------------------------------

export function computeFDCurrentValue(
  principal: number,
  ratePercent: number,
  startDate: string,
  maturityDate: string | null,
  asOf: Date = new Date()
): number {
  const start = new Date(startDate);
  const cap = maturityDate ? new Date(maturityDate) : null;
  const effectiveAsOf = cap && asOf > cap ? cap : asOf;

  const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
  const years = Math.max(0, (effectiveAsOf.getTime() - start.getTime()) / msPerYear);

  const r = ratePercent / 100;
  return principal * Math.pow(1 + r / 4, 4 * years);
}

export function instrumentCurrentValue(
  instrument: ManualInstrument,
  asOf: Date = new Date()
): number {
  if (instrument.asset_type === "FD") {
    if (!instrument.start_date || instrument.rate === null) {
      return instrument.invested_amount; // incomplete data — show principal, not a guess
    }
    return computeFDCurrentValue(
      instrument.invested_amount,
      instrument.rate,
      instrument.start_date,
      instrument.maturity_date,
      asOf
    );
  }
  // ULIP — manually updated value; fall back to invested amount if never set
  return instrument.current_value ?? instrument.invested_amount;
}

// -----------------------------------------------------------------------
// Net worth aggregation — normalizes every holding + instrument to INR
// current value, then sums. This is the one place "current value" gets
// compared across asset types.
// -----------------------------------------------------------------------

export interface NetWorthBreakdown {
  totalINR: number;
  investedINR: number;
  unrealizedPLINR: number;
  priceGapsCount: number; // holdings with no manual price entered yet
  byMember: Record<string, { investedINR: number; currentINR: number }>;
  byAssetType: Record<string, { investedINR: number; currentINR: number }>;
  byCountry: Record<string, { currentINR: number }>;
}

export function toINR(nativeValue: number, currency: Currency, usdInrRate: number): number {
  return currency === "USD" ? nativeValue * usdInrRate : nativeValue;
}

export function computeNetWorth(
  holdings: Holding[],
  instruments: ManualInstrument[],
  usdInrRate: number,
  asOf: Date = new Date()
): NetWorthBreakdown {
  const byMember: NetWorthBreakdown["byMember"] = {};
  const byAssetType: NetWorthBreakdown["byAssetType"] = {};
  const byCountry: NetWorthBreakdown["byCountry"] = {};

  let totalINR = 0;
  let investedINR = 0;
  let priceGapsCount = 0;

  const bumpMember = (memberId: string, invested: number, current: number) => {
    if (!byMember[memberId]) byMember[memberId] = { investedINR: 0, currentINR: 0 };
    byMember[memberId].investedINR += invested;
    byMember[memberId].currentINR += current;
  };
  const bumpAssetType = (type: string, invested: number, current: number) => {
    if (!byAssetType[type]) byAssetType[type] = { investedINR: 0, currentINR: 0 };
    byAssetType[type].investedINR += invested;
    byAssetType[type].currentINR += current;
  };
  const bumpCountry = (country: string, current: number) => {
    if (!byCountry[country]) byCountry[country] = { currentINR: 0 };
    byCountry[country].currentINR += current;
  };

  for (const h of holdings) {
    const investedINRValue = toINR(h.investedValue, h.currency, usdInrRate);
    if (h.currentValue === null) {
      priceGapsCount += 1;
      // still counts toward invested total, just not toward current value
      investedINR += investedINRValue;
      bumpMember(h.memberId, investedINRValue, 0);
      bumpAssetType(h.assetClass, investedINRValue, 0);
      continue;
    }
    const currentINRValue = toINR(h.currentValue, h.currency, usdInrRate);
    totalINR += currentINRValue;
    investedINR += investedINRValue;
    bumpMember(h.memberId, investedINRValue, currentINRValue);
    bumpAssetType(h.assetClass, investedINRValue, currentINRValue);
    bumpCountry(h.country, currentINRValue);
  }

  for (const inst of instruments) {
    const currentNative = instrumentCurrentValue(inst, asOf);
    const currentINRValue = toINR(currentNative, inst.currency, usdInrRate);
    const investedINRValue = toINR(inst.invested_amount, inst.currency, usdInrRate);

    totalINR += currentINRValue;
    investedINR += investedINRValue;
    bumpMember(inst.member_id, investedINRValue, currentINRValue);
    bumpAssetType(inst.asset_type, investedINRValue, currentINRValue);
    bumpCountry("India", currentINRValue);
  }

  return {
    totalINR,
    investedINR,
    unrealizedPLINR: totalINR - investedINR,
    priceGapsCount,
    byMember,
    byAssetType,
    byCountry,
  };
}
