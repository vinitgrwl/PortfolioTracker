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

export interface ExchangeRate {
  id: string;
  user_id: string;
  pair: string; // e.g. "USD_INR"
  rate: number;
  updated_at: string;
}
