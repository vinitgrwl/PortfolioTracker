"use server";

import { revalidatePath } from "next/cache";
import { requireUser, fetchAll } from "@/lib/server-utils";
import { getNseBySymbol, getNseByIsin } from "@/lib/nseEquityIndex";
import { fetchYahooName, toYahooSymbol } from "@/lib/priceFeeds";
import type { Transaction } from "@/lib/types";

/**
 * Fills in asset_name for existing transactions that don't have one —
 * mainly rows imported before this field existed, or from a broker
 * export that never carried a company name (Zerodha's tradebook).
 *
 * One lookup per distinct (ticker, country, isin) combo, not per row —
 * then a single update statement fans it out to every matching
 * transaction. India tickers resolve against the NSE equity index
 * (ISIN match preferred, symbol as fallback); US tickers resolve via
 * Yahoo Finance's chart metadata (same endpoint already used for
 * prices, so no extra API dependency).
 */
export async function backfillAssetNames(): Promise<{
  status: "done";
  updated: number;
  unresolved: number;
}> {
  const { supabase, userId } = await requireUser();

  const rows = await fetchAll<
    Pick<Transaction, "asset_ticker" | "isin" | "country" | "currency">
  >(supabase, "transactions", "asset_ticker, isin, country, currency", (q) =>
    q.eq("user_id", userId).is("asset_name", null)
  );

  type Combo = { ticker: string; isin: string | null; country: string; currency: string };
  const combosByKey = new Map<string, Combo>();
  for (const r of rows) {
    const key = `${r.asset_ticker}::${r.country}`;
    if (!combosByKey.has(key)) {
      combosByKey.set(key, {
        ticker: r.asset_ticker,
        isin: r.isin,
        country: r.country,
        currency: r.currency,
      });
    }
  }
  const combos = Array.from(combosByKey.values());

  let updated = 0;
  let unresolved = 0;

  await Promise.all(
    combos.map(async (c) => {
      let name: string | null = null;

      if (c.country === "India") {
        if (c.isin) {
          const byIsin = await getNseByIsin(c.isin);
          if (byIsin) name = byIsin.name;
        }
        if (!name) {
          const bySymbol = await getNseBySymbol(c.ticker);
          if (bySymbol) name = bySymbol.name;
        }
      } else {
        name = await fetchYahooName(toYahooSymbol(c.ticker, c.country as "United States"));
      }

      if (!name) {
        unresolved += 1;
        return;
      }

      const { count, error } = await supabase
        .from("transactions")
        .update({ asset_name: name }, { count: "exact" })
        .eq("user_id", userId)
        .eq("asset_ticker", c.ticker)
        .eq("country", c.country)
        .is("asset_name", null);

      if (!error) updated += count ?? 0;
    })
  );

  revalidatePath("/transactions");
  revalidatePath("/dashboard");

  return { status: "done", updated, unresolved };
}
