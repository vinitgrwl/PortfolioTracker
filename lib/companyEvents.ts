import type { Transaction, CompanyEvent, Currency, Country } from "./types";
import { securityKey } from "./identity";

function currencyForCountry(country: Country): Currency {
  return country === "India" ? "INR" : "USD";
}

/**
 * Rewrites every transaction dated before a company event's effective
 * date from the old security's identity to the new one, scaling
 * quantity/price by the event's ratio so total transaction value (and
 * therefore cost basis) is unchanged — only the label and share count
 * change. Acquisition dates are preserved, so holding-period-based
 * LTCG/STCG classification carries through the merger correctly.
 *
 * Events are applied in effective_date order, so a security that was
 * renamed twice (or merged then renamed) resolves through the whole
 * chain. Dividend rows are left alone (dividend "quantity" is a cash
 * convention, not a share count, and renaming a company doesn't change
 * dividends already paid).
 *
 * This NEVER touches the transactions table — callers pass this
 * adjusted array into computeHoldings/replayLots/etc. for computed
 * views, while the raw Transactions ledger page reads the table
 * directly, unadjusted.
 */
export function applyCompanyEvents(transactions: Transaction[], events: CompanyEvent[]): Transaction[] {
  if (events.length === 0) return transactions;

  const sorted = [...events].sort((a, b) => a.effective_date.localeCompare(b.effective_date));
  let result = transactions;

  for (const ev of sorted) {
    const oldKey = securityKey(ev.old_isin, ev.old_ticker, ev.old_country);
    const factor = ev.ratio_to / ev.ratio_from;

    result = result.map((t) => {
      if (t.action === "dividend") return t;
      if (t.txn_date >= ev.effective_date) return t; // only pre-event trades get rewritten
      if (securityKey(t.isin, t.asset_ticker, t.country) !== oldKey) return t;

      return {
        ...t,
        asset_ticker: ev.new_ticker,
        isin: ev.new_isin,
        country: ev.new_country,
        currency: currencyForCountry(ev.new_country),
        quantity: t.quantity * factor,
        price: t.price / factor,
      };
    });
  }

  return result;
}

/**
 * Resolves a held security's CURRENT ticker/ISIN/country by walking the
 * same event chain forward — for price lookups only (Yahoo/CoinGecko
 * calls need today's real symbol, not the one it traded under a decade
 * ago). Returns the input unchanged if no event applies.
 */
export function resolveEffectiveIdentity(
  ticker: string,
  isin: string | null,
  country: Country,
  events: CompanyEvent[]
): { ticker: string; isin: string | null; country: Country } {
  if (events.length === 0) return { ticker, isin, country };

  const sorted = [...events].sort((a, b) => a.effective_date.localeCompare(b.effective_date));
  let current = { ticker, isin, country };

  for (const ev of sorted) {
    const oldKey = securityKey(ev.old_isin, ev.old_ticker, ev.old_country);
    if (securityKey(current.isin, current.ticker, current.country) !== oldKey) continue;
    current = { ticker: ev.new_ticker, isin: ev.new_isin, country: ev.new_country };
  }

  return current;
}
