// A transaction's "identity" for dedup purposes — deliberately loose enough to
// catch the same trade re-imported from a different file or a different
// import flow (e.g. overlapping Zerodha FY-wise exports, or an MF bulk sheet
// uploaded twice), but scoped to one member so two people buying the same
// security the same day never collide.
export function transactionFingerprint(t: {
  member_id: string;
  platform: string;
  asset_ticker: string;
  isin: string | null;
  txn_date: string;
  action: string;
  quantity: number;
  price: number;
}): string {
  const identity = t.isin && t.isin.trim() ? t.isin.trim().toUpperCase() : t.asset_ticker.trim().toUpperCase();
  const platform = t.platform.trim().toLowerCase();
  // round to kill float-precision mismatches between two exports/computations
  // of the same trade — 6dp covers fractional shares and MF units, 4dp
  // covers MF NAVs (which carry more decimals than a stock price)
  const qty = Math.round(t.quantity * 1e6) / 1e6;
  const price = Math.round(t.price * 1e4) / 1e4;
  return [t.member_id, platform, identity, t.txn_date, t.action, qty, price].join("::");
}
