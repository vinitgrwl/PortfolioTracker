import type { Currency, Country, AssetClass, Action } from "@/lib/types";

export interface ParsedTransaction {
  txn_date: string; // YYYY-MM-DD
  action: Action;
  asset_ticker: string;
  isin: string | null;
  quantity: number;
  price: number;
  fiat_fees: number;
  currency: Currency;
  country: Country;
  asset_class: AssetClass;
  platform: string;
}

export interface ParseResult {
  /** Whatever identity hint the statement itself carries — a name, email,
   *  or client code. Shown to the person as a cross-check, never used to
   *  auto-select the family member. */
  accountHint: string | null;
  transactions: ParsedTransaction[];
  warnings: string[];
}
