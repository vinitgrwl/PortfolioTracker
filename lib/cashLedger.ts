import type { CashTransaction, Transaction, Currency } from "./types";

// -----------------------------------------------------------------------
// Per-platform cash balance — DERIVED, never stored. Combines:
//   - cash_transactions (deposit/withdrawal/transfer/interest/fees)
//   - the cash effect of buy/sell/dividend rows already in `transactions`
// so the balance always agrees with the transaction ledger, with nothing
// double-entered.
//
// Sign convention (all amounts native currency, not converted):
//   deposit            +amount
//   withdrawal         -amount
//   transfer_send      -amount
//   transfer_deposit   +amount
//   interest           +amount
//   fees               -amount
//   buy                -(quantity*price + fiat_fees)
//   sell               +(quantity*price - fiat_fees)
//   dividend           +price   (convention: quantity=1, price=total cash amount)
// -----------------------------------------------------------------------

export interface PlatformCashBalance {
  platform: string;
  currency: Currency;
  balance: number;
}

function bump(
  map: Map<string, PlatformCashBalance>,
  platform: string,
  currency: Currency,
  delta: number
) {
  const key = `${platform}::${currency}`;
  const existing = map.get(key);
  if (existing) {
    existing.balance += delta;
  } else {
    map.set(key, { platform, currency, balance: delta });
  }
}

export function computeCashBalances(
  cashTransactions: CashTransaction[],
  transactions: Transaction[]
): PlatformCashBalance[] {
  const map = new Map<string, PlatformCashBalance>();

  for (const c of cashTransactions) {
    switch (c.action) {
      case "deposit":
      case "transfer_deposit":
      case "interest":
        bump(map, c.platform, c.currency, c.amount);
        break;
      case "withdrawal":
      case "transfer_send":
      case "fees":
        bump(map, c.platform, c.currency, -c.amount);
        break;
    }
  }

  for (const t of transactions) {
    if (t.action === "buy") {
      bump(map, t.platform, t.currency, -(t.quantity * t.price + t.fiat_fees));
    } else if (t.action === "sell") {
      bump(map, t.platform, t.currency, t.quantity * t.price - t.fiat_fees);
    } else if (t.action === "dividend") {
      bump(map, t.platform, t.currency, t.price);
    }
  }

  return Array.from(map.values()).sort((a, b) =>
    a.platform === b.platform ? a.currency.localeCompare(b.currency) : a.platform.localeCompare(b.platform)
  );
}
