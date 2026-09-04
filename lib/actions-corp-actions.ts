"use server";

import { revalidatePath } from "next/cache";
import { requireUser, fetchAll, str, num } from "@/lib/server-utils";
import {
  fetchYahooSplits,
  fetchNseCorporateActions,
  fetchDhanCorporateActions,
  parseDhanNote,
  type FetchedAction,
} from "@/lib/corporateActionsFeed";
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
  dhanChecked: number;
  dhanAdded: number;
}

/**
 * Best-effort auto-fetch across every distinct security the family
 * currently (or ever) held. US tickers go through Yahoo Finance's split
 * events (reliable). India tickers go through NSE's corporate-actions
 * API first (best-effort — see lib/corporateActionsFeed.ts for why this
 * can come back empty even for a stock that really did split or bonus);
 * when NSE comes back empty, Yahoo's split events are tried as a second
 * source (via the .NS symbol) — this only ever catches splits, not bonus
 * issues, since Yahoo doesn't track those. Dhan's scanX feed is checked
 * third and applied the same way. Duplicates are skipped via the table's
 * unique constraint.
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

  const dhanResult = await fetchDhanCorporateActionsAction();

  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  revalidatePath("/returns");

  return {
    status: "done",
    added,
    checked: securities.length,
    indiaAttempted,
    indiaFound,
    indiaFallbackUsed,
    dhanChecked: dhanResult.checked,
    dhanAdded: dhanResult.added,
  };
}

export async function listCorporateActions(): Promise<CorporateAction[]> {
  const { supabase } = await requireUser();
  return fetchAll<CorporateAction>(supabase, "corporate_actions");
}

// ---------------------------------------------------------------------
// Dhan (India) — third source, auto-applied like NSE/Yahoo (confirmed
// reliable in practice). One call covers the whole India market instead
// of one request per ticker.
// ---------------------------------------------------------------------

export interface DhanFetchResult {
  status: "done";
  checked: number;
  matched: number;
  added: number;
}

/** Pulls every India BONUS/SPLIT for the last 2 years from Dhan in one
 *  call, matches against securities the family has ever held, and
 *  inserts new matches straight into corporate_actions. */
export async function fetchDhanCorporateActionsAction(): Promise<DhanFetchResult> {
  const { supabase, userId } = await requireUser();

  const transactions = await fetchAll<Pick<Transaction, "asset_ticker" | "isin" | "country">>(
    supabase,
    "transactions",
    "asset_ticker, isin, country"
  );

  const indiaTickers = new Map<string, { ticker: string; isin: string | null }>();
  for (const t of transactions) {
    if (t.country !== "India") continue;
    const key = t.asset_ticker.trim().toUpperCase();
    if (!indiaTickers.has(key)) indiaTickers.set(key, { ticker: t.asset_ticker, isin: t.isin });
  }

  if (indiaTickers.size === 0) {
    return { status: "done", checked: 0, matched: 0, added: 0 };
  }

  const today = new Date();
  const twoYearsAgo = new Date(today);
  twoYearsAgo.setFullYear(today.getFullYear() - 2);
  const toDate = today.toISOString().slice(0, 10);
  const fromDate = twoYearsAgo.toISOString().slice(0, 10);

  const dhanActions = await fetchDhanCorporateActions(fromDate, toDate);

  const rows: {
    user_id: string;
    asset_ticker: string;
    isin: string | null;
    country: "India";
    action_type: "split" | "bonus";
    ratio_from: number;
    ratio_to: number;
    ex_date: string;
    source: "auto";
  }[] = [];

  let matched = 0;
  for (const a of dhanActions) {
    const held = indiaTickers.get(a.symbol);
    if (!held) continue; // not one of ours
    matched += 1;

    const parsed = parseDhanNote(a.note);
    if (!parsed) continue; // no recognizable X:Y ratio in the note — skip, nothing to insert

    rows.push({
      user_id: userId,
      asset_ticker: held.ticker,
      isin: held.isin,
      country: "India",
      action_type: a.actType === "BONUS" ? "bonus" : "split",
      ratio_from: parsed.ratio_from,
      ratio_to: parsed.ratio_to,
      ex_date: a.exDate,
      source: "auto",
    });
  }

  let added = 0;
  if (rows.length > 0) {
    const { data, error } = await supabase
      .from("corporate_actions")
      .upsert(rows, { onConflict: "user_id,asset_ticker,country,action_type,ex_date", ignoreDuplicates: true })
      .select("id");
    if (!error) added = data?.length ?? 0;
  }

  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  revalidatePath("/returns");

  return { status: "done", checked: indiaTickers.size, matched, added };
}
