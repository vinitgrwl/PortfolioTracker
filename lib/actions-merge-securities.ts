"use server";

import { revalidatePath } from "next/cache";
import { requireUser, str, optStr } from "@/lib/server-utils";

export interface DistinctSecurity {
  ticker: string;
  isin: string | null;
  country: "India" | "United States";
  currency: "USD" | "INR";
  rowCount: number;
}

/**
 * Every distinct (ticker, isin, country) EXACTLY as stored — no
 * trimming/uppercasing/normalization — so genuinely different raw
 * strings for the same real stock (a typo, a broker-specific spelling,
 * anything the automatic ISIN-based matching can't catch) show up as
 * separate rows here for a human to spot and merge.
 */
export async function listAllSecurities(): Promise<DistinctSecurity[]> {
  const { supabase } = await requireUser();

  const { data } = await supabase
    .from("transactions")
    .select("asset_ticker, isin, country, currency")
    .in("asset_class", ["Stock", "ETF"]);

  const map = new Map<string, DistinctSecurity>();
  for (const row of data ?? []) {
    const key = `${row.asset_ticker}::${row.isin ?? ""}::${row.country}`;
    const existing = map.get(key);
    if (existing) {
      existing.rowCount += 1;
    } else {
      map.set(key, {
        ticker: row.asset_ticker,
        isin: row.isin,
        country: row.country,
        currency: row.currency,
        rowCount: 1,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.ticker.localeCompare(b.ticker));
}

/**
 * Rewrites every transaction matching any of the selected raw
 * (ticker, isin, country) identities to one canonical identity — the
 * actual data fix for "this is the same stock but the app doesn't
 * know it", as opposed to company_events (which model a REAL corporate
 * rename/merger, not a data-entry inconsistency).
 */
export async function mergeSecuritiesAction(formData: FormData) {
  const { supabase, userId } = await requireUser();

  const sourcesJson = str(formData, "sources_json");
  const targetTicker = str(formData, "target_ticker").toUpperCase();
  const targetIsin = optStr(formData, "target_isin");
  const targetCountry = str(formData, "target_country");

  if (!sourcesJson || !targetTicker || !targetCountry) throw new Error("Missing required fields");

  let sources: { ticker: string; isin: string | null; country: string }[];
  try {
    sources = JSON.parse(sourcesJson);
  } catch {
    throw new Error("Could not read the selected rows — reload and try again.");
  }
  if (sources.length === 0) throw new Error("Select at least one row to merge.");

  const targetCurrency = targetCountry === "India" ? "INR" : "USD";

  for (const s of sources) {
    let query = supabase
      .from("transactions")
      .update({ asset_ticker: targetTicker, isin: targetIsin, country: targetCountry, currency: targetCurrency })
      .eq("user_id", userId)
      .eq("asset_ticker", s.ticker)
      .eq("country", s.country);
    query = s.isin ? query.eq("isin", s.isin) : query.is("isin", null);

    const { error } = await query;
    if (error) throw new Error(error.message);
  }

  revalidatePath("/dashboard");
  revalidatePath("/transactions");
  revalidatePath("/returns");
  revalidatePath("/rebalancing");
  revalidatePath("/sector-wise");
  revalidatePath("/screener");
  revalidatePath("/prices");
}
