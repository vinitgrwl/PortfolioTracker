"use server";

import { revalidatePath } from "next/cache";
import { requireUser, str } from "@/lib/server-utils";
import { searchNseEquities, bestNseMatch, type NseEquityRecord } from "@/lib/nseEquityIndex";

export async function searchNseEquitiesAction(query: string): Promise<NseEquityRecord[]> {
  await requireUser();
  return searchNseEquities(query);
}

export interface UnresolvedTicker {
  ticker: string;
  count: number;
  symbol: string | null;
  isin: string | null;
  name: string | null;
  confident: boolean;
}

/**
 * Distinct India-equity tickers this user holds with no ISIN yet (currently
 * only possible via the AngelOne import, which has no ISIN column), each
 * with a best-guess NSE match already attached for the confirm screen.
 */
export async function findUnresolvedTickers(): Promise<UnresolvedTicker[]> {
  const { supabase } = await requireUser();

  const { data } = await supabase
    .from("transactions")
    .select("asset_ticker")
    .is("isin", null)
    .eq("country", "India")
    .in("asset_class", ["Stock", "ETF"]);

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    counts.set(row.asset_ticker, (counts.get(row.asset_ticker) ?? 0) + 1);
  }

  const tickers = Array.from(counts.keys());
  return Promise.all(
    tickers.map(async (ticker) => {
      const match = await bestNseMatch(ticker);
      return {
        ticker,
        count: counts.get(ticker)!,
        symbol: match?.record.symbol ?? null,
        isin: match?.record.isin ?? null,
        name: match?.record.name ?? null,
        confident: match?.confident ?? false,
      };
    })
  );
}

export interface IsinConflict {
  ticker: string;
  country: "India" | "United States";
  isins: { isin: string; count: number }[]; // each distinct ISIN currently on this ticker, and how many rows
  noIsinCount: number;
}

/**
 * Finds tickers where rows disagree on ISIN — more than one distinct
 * non-null ISIN recorded for the same ticker+country. Unlike a missing
 * ISIN (findUnresolvedTickers/resolveIsinAction), this is what actually
 * splits one real holding into multiple groups even after backfilling:
 * the identity rule prefers ISIN when present, so two different ISINs
 * on the same stock never merge on their own.
 */
export async function findIsinConflicts(): Promise<IsinConflict[]> {
  const { supabase } = await requireUser();

  const { data } = await supabase
    .from("transactions")
    .select("asset_ticker, country, isin")
    .in("asset_class", ["Stock", "ETF"]);

  const byKey = new Map<string, { ticker: string; country: "India" | "United States"; isinCounts: Map<string, number>; noIsinCount: number }>();
  for (const row of data ?? []) {
    const key = `${row.asset_ticker.trim().toUpperCase()}::${row.country}`;
    if (!byKey.has(key)) {
      byKey.set(key, { ticker: row.asset_ticker, country: row.country, isinCounts: new Map(), noIsinCount: 0 });
    }
    const g = byKey.get(key)!;
    const isin = row.isin?.trim();
    if (isin) {
      g.isinCounts.set(isin, (g.isinCounts.get(isin) ?? 0) + 1);
    } else {
      g.noIsinCount += 1;
    }
  }

  const conflicts: IsinConflict[] = [];
  for (const g of byKey.values()) {
    if (g.isinCounts.size < 2) continue; // only one (or zero) distinct ISIN — not a conflict
    conflicts.push({
      ticker: g.ticker,
      country: g.country,
      isins: Array.from(g.isinCounts.entries()).map(([isin, count]) => ({ isin, count })),
      noIsinCount: g.noIsinCount,
    });
  }
  return conflicts;
}

/** Normalizes every row for a ticker+country to one chosen ISIN —
 *  including rows that already have a DIFFERENT isin recorded, which
 *  resolveIsinAction (missing-ISIN only) deliberately leaves alone. */
export async function resolveIsinConflict(formData: FormData) {
  const { supabase, userId } = await requireUser();

  const ticker = str(formData, "ticker");
  const country = str(formData, "country");
  const isin = str(formData, "isin");

  if (!ticker || !country || !isin) throw new Error("Missing required fields");

  const { error } = await supabase
    .from("transactions")
    .update({ isin })
    .eq("user_id", userId)
    .eq("asset_ticker", ticker)
    .eq("country", country);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard");
  revalidatePath("/transactions");
  revalidatePath("/returns");
  revalidatePath("/rebalancing");
  revalidatePath("/sector-wise");
  revalidatePath("/screener");
}

export type ResolveIsinState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "done"; updated: number };

/**
 * Backfills ISIN on every transaction row matching a given free-text
 * ticker (company name) that still has no ISIN. This is the step that
 * actually merges an AngelOne holding with the same company imported
 * (with ISIN) from another broker — the identity rule elsewhere in the
 * app already prefers ISIN when present.
 */
export async function resolveIsinAction(
  _prevState: ResolveIsinState,
  formData: FormData
): Promise<ResolveIsinState> {
  const { supabase, userId } = await requireUser();

  const rowsJson = str(formData, "rows_json");
  if (!rowsJson) return { status: "error", message: "Nothing to resolve." };

  let rows: { ticker: string; isin: string | null }[];
  try {
    rows = JSON.parse(rowsJson);
  } catch {
    return { status: "error", message: "Could not read the confirmed matches — reload and try again." };
  }

  const confirmed = rows.filter((r) => r.isin);
  if (confirmed.length === 0) {
    return { status: "error", message: "No matches confirmed yet." };
  }

  let updated = 0;
  for (const r of confirmed) {
    const { error, count } = await supabase
      .from("transactions")
      .update({ isin: r.isin }, { count: "exact" })
      .eq("user_id", userId)
      .eq("asset_ticker", r.ticker)
      .is("isin", null);
    if (error) return { status: "error", message: error.message };
    updated += count ?? 0;
  }

  revalidatePath("/dashboard");
  revalidatePath("/transactions");

  return { status: "done", updated };
}
