export type Currency = "USD" | "INR";
export type Country = "United States" | "India";
export type AssetClass = "Stock" | "ETF" | "Crypto" | "Mutual Fund";
export type Action = "buy" | "sell" | "dividend";
export type InstrumentType = "FD" | "ULIP";

export interface Member {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  member_id: string;
  txn_date: string; // ISO date
  platform: string;
  action: Action;
  asset_ticker: string;
  asset_name: string | null;
  isin: string | null;
  quantity: number;
  price: number; // for dividends: total cash amount, quantity = 1 by convention
  fiat_fees: number;
  currency: Currency;
  country: Country;
  asset_class: AssetClass;
  sector: string | null;
  strategy: string | null;
  notes: string | null;
  created_at: string;
}

export interface ManualInstrument {
  id: string;
  user_id: string;
  member_id: string;
  asset_type: InstrumentType;
  label: string;
  invested_amount: number;
  rate: number | null; // FD only, annual %, quarterly compounding
  start_date: string | null; // FD only
  maturity_date: string | null; // FD only
  current_value: number | null; // ULIP only, manually updated
  current_value_updated_at: string | null;
  currency: Currency;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface LatestPrice {
  id: string;
  user_id: string;
  asset_ticker: string;
  isin: string | null;
  currency: Currency;
  current_price: number;
  updated_at: string;
}

export type CorporateActionType = "split" | "bonus";

export interface CorporateAction {
  id: string;
  user_id: string;
  asset_ticker: string;
  isin: string | null;
  country: Country;
  action_type: CorporateActionType;
  // split: ratio_from old shares become ratio_to new shares (e.g. 1:5 -> 1, 5)
  // bonus: ratio_to bonus shares issued per ratio_from held (e.g. 1:1 -> 1, 1)
  ratio_from: number;
  ratio_to: number;
  ex_date: string; // ISO date
  source: "manual" | "auto";
  created_at: string;
}

export interface ExchangeRate {
  id: string;
  user_id: string;
  pair: string; // e.g. "USD_INR"
  rate: number;
  updated_at: string;
}

export interface PendingCorporateAction {
  id: string;
  user_id: string;
  asset_ticker: string;
  isin: string | null;
  country: Country;
  action_type: CorporateActionType;
  raw_note: string;
  dhan_symbol: string | null;
  parsed_ratio_from: number | null;
  parsed_ratio_to: number | null;
  ex_date: string;
  created_at: string;
}

// ---------------------------------------------------------------------
// Cash ledger
// ---------------------------------------------------------------------

export type CashAction =
  | "deposit"
  | "withdrawal"
  | "transfer_send"
  | "transfer_deposit"
  | "interest"
  | "fees";

export interface CashTransaction {
  id: string;
  user_id: string;
  member_id: string;
  txn_date: string;
  platform: string;
  action: CashAction;
  amount: number; // always positive — sign comes from `action`
  currency: Currency;
  transfer_group_id: string | null;
  counterparty_platform: string | null;
  notes: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------
// Watchlist
// ---------------------------------------------------------------------

export type WatchlistAssetClass = "Stock" | "ETF" | "Crypto";

export interface WatchlistItem {
  id: string;
  user_id: string;
  asset_ticker: string;
  asset_name: string | null;
  country: Country;
  asset_class: WatchlistAssetClass;
  currency: Currency;
  target_price: number | null;
  notes: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------
// Rebalancing
// ---------------------------------------------------------------------

export type RebalanceAssetClass = "Stock" | "ETF" | "Crypto" | "Mutual Fund" | "FD" | "ULIP";

export interface AssetClassTarget {
  id: string;
  user_id: string;
  asset_class: RebalanceAssetClass;
  target_weight_pct: number;
  created_at: string;
  updated_at: string;
}

export interface TickerTarget {
  id: string;
  user_id: string;
  asset_class: AssetClass; // Stock/ETF/Crypto/Mutual Fund only
  asset_ticker: string;
  isin: string | null;
  target_weight_pct: number;
  created_at: string;
  updated_at: string;
}
