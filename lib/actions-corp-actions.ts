"use server";

import { revalidatePath } from "next/cache";
import { requireUser, fetchAll, str, num } from "@/lib/server-utils";
import { fetchYahooSplits, fetchNseCorporateActions, type FetchedAction } from "@/lib/corporateActionsFeed";
import { toYahooSymbol } from "@/lib/priceFeeds";
import type { Transaction, CorporateAction } from "@/lib/types";

export async function addCorporateAction(formData: FormData) {
  const { supabase, userId } = await requireUser();

  const row = {
    user_id: userId,
    asset_ticker: str(formData, "asset_ticker").toUpperCase(),
    isin: str(formData, "isin") || null,
    country: str(formData, "country"),
    action_type: str(formData, "action_type"),
    ratio_from: num(formData, "ratio_from"),
    ratio_to: num(formData, "ratio_to"),
    ex_date: str(formData, "ex_date"),
    source: "manual" as const,
  };

  if (!row.asset_ticker || !row.country || !row.action_type || !row.ex_date || !row.ratio_from || !row.ratio_to) {
    throw new Error("Missing required fields");
  }

  const { error } = await supabase.from("corporate_actions").insert(row);
  if (error) throw new Error(error.message);

  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  revalidatePath("/returns");
}

export async function deleteCorporateAction(formData: FormData) {
  const { supabase, userId } = await requireUser();
  const id = str(formData, "id");

  const { error } = await supabase.from("corporate_actions").delete().eq("id", id).eq("user_id", userId);
  if (error) throw new Error(error.message);

  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  revalidatePath("/returns");
}

export interface AutoFetchResult {
  status: "done";
  added: number;
  checked: number;
  indiaAttempted: boolean;
  indiaFound: number;
  indiaFallbackUsed: number;
}

/**
 * Best-effort auto-fetch across every distinct security the family
 * currently (or ever) held. US tickers go through Yahoo Finance's split
 * events (reliable). India tickers go through NSE's corporate-actions
 * API first (best-effort — see lib/corporateActionsFeed.ts for why this
 * can come back empty even for a stock that really did split or bonus);
 * when NSE comes back empty, Yahoo's split events are tried as a second
 * source (via the .NS symbol) — this only ever catches splits, not bonus
 * issues, since Yahoo doesn't track those. Duplicates are skipped via
 * the table's unique constraint.
 */
export async function autoFetchCorporateActions(): Promise<AutoFetchResult> {
  const { supabase, userId } = await requireUser();

  const transactions = await fetchAll<Pick<Transaction, "asset_ticker" | "isin" | "country">>(
    supabase,
    "transactions",
    "asset_ticker, isin, country"
  );

  const distinct = new Map<string, { ticker: string; isin: string | null; country: string }>();
  for (const t of transactions) {
    const key = `${t.asset_ticker}::${t.country}`;
    if (!distinct.has(key)) distinct.set(key, { ticker: t.asset_ticker, isin: t.isin, country: t.country });
  }
  const securities = Array.from(distinct.values());

  let added = 0;
  let indiaAttempted = false;
  let indiaFound = 0;
  let indiaFallbackUsed = 0;

  await Promise.all(
    securities.map(async (s) => {
      let found: FetchedAction[];
      if (s.country === "United States") {
        found = await fetchYahooSplits(toYahooSymbol(s.ticker, "United States"));
      } else {
        indiaAttempted = true;
        found = await fetchNseCorporateActions(s.ticker);
        indiaFound += found.length;
        if (found.length === 0) {
          const yahooFallback = await fetchYahooSplits(toYahooSymbol(s.ticker, "India"));
          if (yahooFallback.length > 0) {
            indiaFallbackUsed += 1;
            found = yahooFallback;
          }
        }
      }

      if (found.length === 0) return;

      const rows = found.map((f) => ({
        user_id: userId,
        asset_ticker: s.ticker,
        isin: s.isin,
        country: s.country,
        action_type: f.action_type,
        ratio_from: f.ratio_from,
        ratio_to: f.ratio_to,
        ex_date: f.ex_date,
        source: "auto" as const,
      }));

      const { data, error } = await supabase
        .from("corporate_actions")
        .upsert(rows, { onConflict: "user_id,asset_ticker,country,action_type,ex_date", ignoreDuplicates: true })
        .select("id");

      if (!error) added += data?.length ?? 0;
    })
  );

  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  revalidatePath("/returns");

  return { status: "done", added, checked: securities.length, indiaAttempted, indiaFound, indiaFallbackUsed };
}

export async function listCorporateActions(): Promise<CorporateAction[]> {
  const { supabase } = await requireUser();
  return fetchAll<CorporateAction>(supabase, "corporate_actions");
}
