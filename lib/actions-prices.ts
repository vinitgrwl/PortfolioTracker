"use server";

import { revalidatePath } from "next/cache";
import { requireUser, fetchAll } from "@/lib/server-utils";
import {
  fetchYahooBatch,
  toYahooSymbol,
  fetchCryptoPrices,
  fetchAmfiNavMap,
  CRYPTO_ID_MAP,
} from "@/lib/priceFeeds";
import { resolveEffectiveIdentity } from "@/lib/companyEvents";
import { backfillIsins } from "@/lib/identity";
import type { Transaction, CompanyEvent, Currency, Country, AssetClass } from "@/lib/types";

const STALE_AFTER_MS = 5 * 60 * 1000; // don't re-hit external APIs more than this often

interface HoldingKey {
  ticker: string;
  isin: string | null;
  currency: Currency;
  country: Country;
  assetClass: AssetClass;
}

/**
 * Refreshes latest_prices + the USD/INR rate for every distinct holding
 * the user currently has, from live sources (Yahoo Finance, CoinGecko,
 * AMFI). Best-effort: symbols it can't resolve are left untouched, so
 * they keep showing up in the Prices page's "Missing prices" list for
 * manual entry.
 *
 * @param force  Skip the staleness check and refetch everything now.
 *               Used by the manual "Refresh Now" button.
 */
export async function refreshLivePrices(force = false) {
  const { supabase, userId } = await requireUser();

  const [rawTransactions, companyEvents, pricesRes, rateRes] = await Promise.all([
    fetchAll<Pick<Transaction, "asset_ticker" | "isin" | "currency" | "country" | "asset_class">>(
      supabase,
      "transactions",
      "asset_ticker, isin, currency, country, asset_class"
    ),
    fetchAll<CompanyEvent>(supabase, "company_events"),
    supabase.from("latest_prices").select("asset_ticker, currency, updated_at"),
    supabase.from("exchange_rates").select("updated_at").eq("pair", "USD_INR").maybeSingle(),
  ]);
  const transactions = backfillIsins(rawTransactions);


  const now = Date.now();
  const staleness = new Map<string, number>(); // "TICKER::CCY" -> age in ms
  for (const p of pricesRes.data ?? []) {
    staleness.set(`${p.asset_ticker}::${p.currency}`, now - new Date(p.updated_at).getTime());
  }

  // Dedup holdings by EFFECTIVE ticker+currency — a renamed/merged
  // security must be priced (and stored in latest_prices) under its
  // current symbol, since that's the identity computeHoldings looks up
  // once company_events has rewritten the transaction it's replaying.
  const holdings = new Map<string, HoldingKey>();
  for (const t of transactions) {
    const effective = resolveEffectiveIdentity(t.asset_ticker, t.isin, t.country, companyEvents);
    const ticker = effective.ticker.trim().toUpperCase();
    const currency: Currency = effective.country === "India" ? "INR" : "USD";
    const key = `${ticker}::${currency}`;
    if (!holdings.has(key)) {
      holdings.set(key, {
        ticker,
        isin: effective.isin,
        currency,
        country: effective.country,
        assetClass: t.asset_class,
      });
    }
  }

  const isFresh = (ticker: string, currency: Currency) => {
    if (force) return false;
    const age = staleness.get(`${ticker}::${currency}`);
    return age !== undefined && age < STALE_AFTER_MS;
  };

  const toRefresh = Array.from(holdings.values()).filter((h) => !isFresh(h.ticker, h.currency));

  const yahooSymbolFor = (h: HoldingKey) => toYahooSymbol(h.ticker, h.country);

  const stockHoldings = toRefresh.filter((h) => h.assetClass === "Stock" || h.assetClass === "ETF");
  const cryptoHoldings = toRefresh.filter((h) => h.assetClass === "Crypto");
  const mfHoldings = toRefresh.filter((h) => h.assetClass === "Mutual Fund" && h.isin);

  const rateAge = rateRes.data ? now - new Date(rateRes.data.updated_at).getTime() : Infinity;
  const shouldRefreshRate = force || rateAge >= STALE_AFTER_MS;

  const yahooSymbols = stockHoldings.map(yahooSymbolFor);
  if (shouldRefreshRate) yahooSymbols.push("INR=X");

  const [yahooPrices, cryptoPrices, mfNavMap] = await Promise.all([
    yahooSymbols.length > 0 ? fetchYahooBatch(yahooSymbols) : Promise.resolve(new Map<string, number>()),
    cryptoHoldings.length > 0
      ? fetchCryptoPrices(cryptoHoldings.map((h) => CRYPTO_ID_MAP[h.ticker]).filter((id): id is string => Boolean(id)))
      : Promise.resolve(new Map<string, { usd?: number; inr?: number }>()),
    mfHoldings.length > 0 ? fetchAmfiNavMap() : Promise.resolve(new Map<string, number>()),
  ]);

  const nowIso = new Date().toISOString();
  const rows: {
    user_id: string;
    asset_ticker: string;
    isin: string | null;
    currency: Currency;
    current_price: number;
    updated_at: string;
  }[] = [];

  for (const h of stockHoldings) {
    const price = yahooPrices.get(yahooSymbolFor(h));
    if (price !== undefined) {
      rows.push({ user_id: userId, asset_ticker: h.ticker, isin: h.isin, currency: h.currency, current_price: price, updated_at: nowIso });
    }
  }

  for (const h of cryptoHoldings) {
    const coinId = CRYPTO_ID_MAP[h.ticker];
    if (!coinId) continue;
    const quote = cryptoPrices.get(coinId);
    const price = h.currency === "INR" ? quote?.inr : quote?.usd;
    if (price !== undefined) {
      rows.push({ user_id: userId, asset_ticker: h.ticker, isin: h.isin, currency: h.currency, current_price: price, updated_at: nowIso });
    }
  }

  for (const h of mfHoldings) {
    const nav = h.isin ? mfNavMap.get(h.isin) : undefined;
    if (nav !== undefined) {
      // AMFI NAV is always INR-denominated
      rows.push({ user_id: userId, asset_ticker: h.ticker, isin: h.isin, currency: "INR", current_price: nav, updated_at: nowIso });
    }
  }

  if (rows.length > 0) {
    const { error } = await supabase.from("latest_prices").upsert(rows, { onConflict: "user_id,asset_ticker,currency" });
    if (error) throw new Error(error.message);
  }

  const usdInr = yahooPrices.get("INR=X");
  if (shouldRefreshRate && usdInr !== undefined) {
    const { error } = await supabase
      .from("exchange_rates")
      .upsert({ user_id: userId, pair: "USD_INR", rate: usdInr, updated_at: nowIso }, { onConflict: "user_id,pair" });
    if (error) throw new Error(error.message);
  }

  revalidatePath("/dashboard");
  revalidatePath("/prices");

  return { pricesUpdated: rows.length, rateUpdated: shouldRefreshRate && usdInr !== undefined };
}

/** Form-action wrapper for the "Refresh Now" button — always forces a refetch. */
export async function refreshLivePricesAction(_formData: FormData) {
  await refreshLivePrices(true);
}
