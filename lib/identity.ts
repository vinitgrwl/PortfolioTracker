import type { Country } from "./types";

/**
 * If a security was bought via one broker whose statement includes ISIN
 * (Zerodha, Groww) and another that doesn't (AngelOne), rows with a null
 * ISIN group separately from the ISIN'd ones under the holding-identity
 * rule used everywhere in this app (isin || ticker::currency) — the same
 * stock then shows up as two (or more) separate holdings, one of them
 * permanently missing a price. This backfills the gap: for any ticker
 * (scoped by country) where at least one row has an ISIN recorded, every
 * row sharing that exact ticker+country gets that same ISIN, so they all
 * group together.
 *
 * This does NOT help when the ticker string itself differs across
 * brokers (e.g. a genuine spelling mismatch) — that still needs the
 * "Fix missing ISINs" resolver on the Transactions page.
 */
export function backfillIsins<T extends { asset_ticker: string; isin: string | null; country: Country }>(
  rows: T[]
): T[] {
  const tickerToIsin = new Map<string, string>();
  for (const r of rows) {
    if (!r.isin || !r.isin.trim()) continue;
    const key = `${r.asset_ticker.trim().toUpperCase()}::${r.country}`;
    if (!tickerToIsin.has(key)) tickerToIsin.set(key, r.isin.trim());
  }
  if (tickerToIsin.size === 0) return rows;

  return rows.map((r) => {
    if (r.isin && r.isin.trim()) return r;
    const key = `${r.asset_ticker.trim().toUpperCase()}::${r.country}`;
    const backfilled = tickerToIsin.get(key);
    return backfilled ? { ...r, isin: backfilled } : r;
  });
}

// ---------------------------------------------------------------------
// Canonical identity key — used everywhere a security needs to be
// grouped (holdings, FIFO lots, corporate actions, company events, the
// screener). ISIN when present (trimmed + uppercased), else
// ticker+country (trimmed + uppercased), so "VBL" vs " vbl " vs an
// ISIN typed in lowercase don't silently fragment one real holding
// into several. Run backfillIsins() first when the row set may include
// ISIN-less imports (AngelOne) alongside ISIN'd ones — this key alone
// only fixes case/whitespace mismatches, not a missing ISIN.
// ---------------------------------------------------------------------

export function securityKey(isin: string | null | undefined, ticker: string, country: Country): string {
  const normalizedIsin = isin?.trim().toUpperCase();
  if (normalizedIsin) return normalizedIsin;
  const currency = country === "India" ? "INR" : "USD";
  return `${ticker.trim().toUpperCase()}::${currency}`;
}

/** Same as securityKey, for the handful of tables (latest_prices) that
 *  store currency but not country. */
export function securityKeyFromCurrency(
  isin: string | null | undefined,
  ticker: string,
  currency: "USD" | "INR"
): string {
  const normalizedIsin = isin?.trim().toUpperCase();
  if (normalizedIsin) return normalizedIsin;
  return `${ticker.trim().toUpperCase()}::${currency}`;
}
