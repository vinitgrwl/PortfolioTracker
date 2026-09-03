"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/server-utils";
import type { Transaction, ManualInstrument } from "@/lib/types";
import { toYahooSymbol, CRYPTO_ID_MAP } from "@/lib/priceFeeds";
import {
  fetchYahooHistoryBatch,
  fetchCoinGeckoHistory,
  fetchAmfiSchemeCodeMap,
  fetchMfApiHistory,
  ForwardFiller,
  dateRangeDaily,
} from "@/lib/historicalPrices";
import { computeDailyNetWorthSeries, holdingKey } from "@/lib/networthHistory";

/**
 * One-time (or on-demand) full backfill: reconstructs a daily net worth
 * point for every day from the earliest transaction/instrument to today,
 * using historical price series, and upserts the whole series into
 * net_worth_snapshots. This makes many external API calls — it's meant
 * to be triggered manually, not on every page load.
 */
export async function buildNetWorthHistory() {
  const { supabase, userId } = await requireUser();

  const [txnsRes, instrumentsRes] = await Promise.all([
    supabase.from("transactions").select("*"),
    supabase.from("manual_instruments").select("*"),
  ]);

  const transactions = (txnsRes.data ?? []) as Transaction[];
  const instruments = (instrumentsRes.data ?? []) as ManualInstrument[];

  if (transactions.length === 0 && instruments.length === 0) {
    return { pointsWritten: 0 };
  }

  const earliestTxnDate = transactions.reduce(
    (min, t) => (t.txn_date < min ? t.txn_date : min),
    transactions[0]?.txn_date ?? "9999-12-31"
  );
  const earliestInstDate = instruments.reduce(
    (min, i) => {
      const d = i.start_date ?? i.created_at.slice(0, 10);
      return d < min ? d : min;
    },
    instruments[0] ? instruments[0].start_date ?? instruments[0].created_at.slice(0, 10) : "9999-12-31"
  );
  const earliest = [earliestTxnDate, earliestInstDate].filter((d) => d !== "9999-12-31").sort()[0];
  if (!earliest) return { pointsWritten: 0 };

  const dates = dateRangeDaily(new Date(`${earliest}T00:00:00Z`), new Date());

  // Distinct holdings, same identity rule as the rest of the app (ISIN when present).
  const holdings = new Map<
    string,
    { ticker: string; isin: string | null; currency: "USD" | "INR"; country: "India" | "United States"; assetClass: string }
  >();
  for (const t of transactions) {
    const key = holdingKey(t);
    if (!holdings.has(key)) {
      holdings.set(key, {
        ticker: t.asset_ticker,
        isin: t.isin,
        currency: t.currency,
        country: t.country,
        assetClass: t.asset_class,
      });
    }
  }

  const stockHoldings = Array.from(holdings.entries()).filter(
    ([, h]) => h.assetClass === "Stock" || h.assetClass === "ETF"
  );
  const cryptoHoldings = Array.from(holdings.entries()).filter(([, h]) => h.assetClass === "Crypto");
  const mfHoldings = Array.from(holdings.entries()).filter(([, h]) => h.assetClass === "Mutual Fund" && h.isin);

  const yahooSymbols = stockHoldings.map(([, h]) => toYahooSymbol(h.ticker, h.country));
  yahooSymbols.push("INR=X");

  const [yahooHistories, amfiSchemeMap] = await Promise.all([
    fetchYahooHistoryBatch(yahooSymbols),
    mfHoldings.length > 0 ? fetchAmfiSchemeCodeMap() : Promise.resolve(new Map<string, string>()),
  ]);

  // Crypto: one CoinGecko call per (coinId, currency) pair actually needed.
  const cryptoPairs = new Map<string, { coinId: string; currency: "usd" | "inr" }>();
  for (const [, h] of cryptoHoldings) {
    const coinId = CRYPTO_ID_MAP[h.ticker.toUpperCase()];
    if (!coinId) continue;
    const currency = h.currency === "INR" ? "inr" : "usd";
    cryptoPairs.set(`${coinId}::${currency}`, { coinId, currency });
  }
  const cryptoEntries = Array.from(cryptoPairs.entries());
  const cryptoHistories = new Map<string, Map<string, number>>();
  const cryptoResults = await Promise.allSettled(
    cryptoEntries.map(([, p]) => fetchCoinGeckoHistory(p.coinId, p.currency))
  );
  cryptoEntries.forEach(([pairKey], i) => {
    const r = cryptoResults[i];
    cryptoHistories.set(pairKey, r.status === "fulfilled" ? r.value : new Map());
  });

  // MF: one mfapi.in call per distinct scheme code actually held.
  const mfSchemeCodes = new Set<string>();
  for (const [, h] of mfHoldings) {
    const code = h.isin ? amfiSchemeMap.get(h.isin) : undefined;
    if (code) mfSchemeCodes.add(code);
  }
  const mfCodeList = Array.from(mfSchemeCodes);
  const mfHistories = new Map<string, Map<string, number>>();
  const mfResults = await Promise.allSettled(mfCodeList.map((code) => fetchMfApiHistory(code)));
  mfCodeList.forEach((code, i) => {
    const r = mfResults[i];
    mfHistories.set(code, r.status === "fulfilled" ? r.value : new Map());
  });

  // Assemble one ForwardFiller per holding key.
  const priceSeriesByHolding = new Map<string, ForwardFiller>();
  for (const [key, h] of stockHoldings) {
    const symbol = toYahooSymbol(h.ticker, h.country);
    priceSeriesByHolding.set(key, new ForwardFiller(yahooHistories.get(symbol) ?? new Map()));
  }
  for (const [key, h] of cryptoHoldings) {
    const coinId = CRYPTO_ID_MAP[h.ticker.toUpperCase()];
    if (!coinId) continue;
    const currency = h.currency === "INR" ? "inr" : "usd";
    priceSeriesByHolding.set(key, new ForwardFiller(cryptoHistories.get(`${coinId}::${currency}`) ?? new Map()));
  }
  for (const [key, h] of mfHoldings) {
    const code = h.isin ? amfiSchemeMap.get(h.isin) : undefined;
    priceSeriesByHolding.set(key, new ForwardFiller(code ? mfHistories.get(code) ?? new Map() : new Map()));
  }

  const usdInrSeries = new ForwardFiller(yahooHistories.get("INR=X") ?? new Map());

  const series = computeDailyNetWorthSeries(transactions, instruments, dates, priceSeriesByHolding, usdInrSeries);

  const rows = series.map((p) => ({
    user_id: userId,
    snapshot_date: p.date,
    total_inr: p.totalInr,
  }));

  // Upsert in chunks — Supabase/PostgREST payloads shouldn't get too large.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("net_worth_snapshots")
      .upsert(chunk, { onConflict: "user_id,snapshot_date" });
    if (error) throw new Error(error.message);
  }

  revalidatePath("/dashboard");
  return { pointsWritten: rows.length };
}

/** Form-action wrapper for the "Build Full History" button. */
export async function buildNetWorthHistoryAction(_formData: FormData) {
  await buildNetWorthHistory();
}

/**
 * Cheap, called on every Dashboard load: if today's snapshot doesn't
 * exist yet, write it from an already-computed total (no extra API
 * calls — the caller passes in what it just computed for the page).
 */
export async function ensureTodaySnapshot(totalInr: number) {
  const { supabase, userId } = await requireUser();
  const today = new Date().toISOString().slice(0, 10);

  const existing = await supabase
    .from("net_worth_snapshots")
    .select("id")
    .eq("snapshot_date", today)
    .maybeSingle();

  if (existing.data) return; // already have today's point

  const { error } = await supabase
    .from("net_worth_snapshots")
    .upsert(
      { user_id: userId, snapshot_date: today, total_inr: totalInr },
      { onConflict: "user_id,snapshot_date" }
    );
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard");
}
