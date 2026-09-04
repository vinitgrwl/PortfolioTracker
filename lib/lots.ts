import type { Transaction, CorporateAction, Currency, Country, AssetClass } from "./types";
import { securityKey } from "./identity";

export interface Lot {
  date: string; // acquisition date — for bonus lots, this is the bonus ex_date
  qty: number;
  costPerUnit: number; // native currency; 0 for bonus-issued lots
}

export type GainClassification = "STCG" | "LTCG" | "VDA";

export interface RealizedTrade {
  memberId: string;
  key: string; // ISIN or ticker::currency — same identity rule as the rest of the app
  ticker: string;
  isin: string | null;
  currency: Currency;
  country: Country;
  assetClass: AssetClass;
  sellDate: string;
  buyDate: string;
  quantity: number;
  proceedsNative: number;
  costBasisNative: number;
  gainNative: number;
  holdingDays: number;
  classification: GainClassification;
  fy: string; // "FY2024-25"
}

/** Indian financial year (Apr 1 – Mar 31) label for a YYYY-MM-DD date. */
export function fyLabel(dateStr: string): string {
  const [y, m] = dateStr.split("-").map(Number);
  const startYear = m >= 4 ? y : y - 1;
  return `FY${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/**
 * India capital-gains classification (general rules — not tax advice,
 * and doesn't distinguish equity vs debt mutual funds since that isn't
 * tracked; debt funds actually have no LTCG concept post the 2023
 * amendment and are always short-term regardless of holding period):
 *  - Crypto/VDA: flat 30% either way, no STCG/LTCG split, shown separately.
 *  - Listed Indian equity/ETF/Mutual Fund: LTCG if held > 12 months.
 *  - Foreign shares (US stocks): LTCG if held > 24 months.
 */
function classify(assetClass: AssetClass, country: Country, holdingDays: number): GainClassification {
  if (assetClass === "Crypto") return "VDA";
  const longTermThresholdDays = assetClass !== "Mutual Fund" && country === "United States" ? 730 : 365;
  return holdingDays > longTermThresholdDays ? "LTCG" : "STCG";
}

export function holdingKey(t: Pick<Transaction, "isin" | "asset_ticker" | "currency" | "country">) {
  return securityKey(t.isin, t.asset_ticker, t.country);
}

function actionKey(a: Pick<CorporateAction, "isin" | "asset_ticker" | "country">) {
  return securityKey(a.isin, a.asset_ticker, a.country);
}

type BuySellEvent = { kind: "buy" | "sell"; date: string; t: Transaction };
type ActionEvent = { kind: "action"; date: string; a: CorporateAction };
type Event = BuySellEvent | ActionEvent;

/**
 * Replays every (member, holding) group's transaction history in date
 * order, applying splits/bonuses as they occur, and matching sells to
 * buy lots FIFO. This is the single place split/bonus math happens —
 * both current holdings (networth.ts) and realized P&L (returns page)
 * derive from the same replay so they can never disagree.
 *
 * Split: every lot currently held gets scaled — qty *= factor,
 * costPerUnit /= factor — keeping each lot's own acquisition date, so
 * holding periods for LTCG/STCG are unaffected by a split. For India,
 * the result is floored to whole shares (see the fractional-share note
 * below); US fractional shares are left as-is.
 *
 * Bonus: existing lots are untouched. A new lot is added, dated the
 * bonus ex_date, with cost 0 — bonus shares get their own holding
 * period starting from the bonus date and (per standard tax treatment)
 * zero cost of acquisition, rather than spreading cost across all
 * shares the way a split does. For India, floored to whole shares.
 *
 * On a sell that exceeds recorded holdings (a data gap — a corporate
 * action or an import is missing), the shortfall is silently dropped
 * rather than guessing a cost basis for shares with no purchase record.
 */
export function replayLots(
  transactions: Transaction[],
  corporateActions: CorporateAction[]
): { lotsByGroup: Map<string, Lot[]>; realizedTrades: RealizedTrade[] } {
  const memberIds = Array.from(new Set(transactions.map((t) => t.member_id)));
  const eventsByGroup = new Map<string, Event[]>();

  const pushEvent = (groupKey: string, ev: Event) => {
    if (!eventsByGroup.has(groupKey)) eventsByGroup.set(groupKey, []);
    eventsByGroup.get(groupKey)!.push(ev);
  };

  for (const t of transactions) {
    if (t.action === "dividend") continue;
    const groupKey = `${t.member_id}::${holdingKey(t)}`;
    pushEvent(groupKey, { kind: t.action, date: t.txn_date, t });
  }

  // A corporate action applies to every member who holds that security —
  // fan it out to each member's group for the matching identity key.
  for (const a of corporateActions) {
    const key = actionKey(a);
    for (const memberId of memberIds) {
      const groupKey = `${memberId}::${key}`;
      if (eventsByGroup.has(groupKey)) {
        pushEvent(groupKey, { kind: "action", date: a.ex_date, a });
      }
    }
  }

  const lotsByGroup = new Map<string, Lot[]>();
  const realizedTrades: RealizedTrade[] = [];

  for (const [groupKey, events] of eventsByGroup) {
    // Same-date ordering: actions before buy/sell (adjust holdings as of
    // the ex-date before the day's own trades), buys before sells.
    const order = { action: 0, buy: 1, sell: 2 } as const;
    events.sort((x, y) => (x.date !== y.date ? x.date.localeCompare(y.date) : order[x.kind] - order[y.kind]));

    const queue: Lot[] = [];

    for (const ev of events) {
      if (ev.kind === "action") {
        const a = ev.a;
        const factor = a.ratio_to / a.ratio_from;
        // India-listed shares can't hold a fractional quantity — a
        // ratio like 3:1 (bonus) applied to 2 held shares would work
        // out to 0.667 new shares, which doesn't exist. In practice the
        // registrar rounds every shareholder down to whole shares and
        // sells the pooled fractional remainders in the market, crediting
        // the pro-rata cash back separately — an amount that depends on
        // that day's market price, which isn't data this app has, so it
        // isn't auto-generated as a transaction. We only floor the share
        // count here; if you receive a fractional-shares payout, log it
        // yourself under Cash → Interest. US fractional shares (Vested)
        // are unaffected — this rounding only applies to India.
        if (a.action_type === "split") {
          for (const lot of queue) {
            const originalTotalCost = lot.qty * lot.costPerUnit;
            let newQty = lot.qty * factor;
            if (a.country === "India") newQty = Math.floor(newQty + 1e-9);
            lot.qty = newQty;
            lot.costPerUnit = newQty > 1e-9 ? originalTotalCost / newQty : 0;
          }
        } else {
          // bonus — new zero-cost lot, own date, existing lots untouched
          const heldQty = queue.reduce((sum, l) => sum + l.qty, 0);
          let bonusQty = heldQty * factor;
          if (a.country === "India") bonusQty = Math.floor(bonusQty + 1e-9);
          if (bonusQty > 1e-9) {
            queue.push({ date: a.ex_date, qty: bonusQty, costPerUnit: 0 });
          }
        }
        continue;
      }

      const t = ev.t;

      if (ev.kind === "buy") {
        const costPerUnit = t.quantity > 0 ? (t.quantity * t.price + t.fiat_fees) / t.quantity : 0;
        queue.push({ date: t.txn_date, qty: t.quantity, costPerUnit });
        continue;
      }

      // sell
      let remaining = t.quantity;
      const proceedsPerUnit = t.quantity > 0 ? (t.quantity * t.price - t.fiat_fees) / t.quantity : 0;

      while (remaining > 1e-9 && queue.length > 0) {
        const lot = queue[0];
        const consumeQty = Math.min(remaining, lot.qty);
        const holdingDays = Math.round(
          (new Date(`${t.txn_date}T00:00:00Z`).getTime() - new Date(`${lot.date}T00:00:00Z`).getTime()) /
            (24 * 60 * 60 * 1000)
        );
        const classification = classify(t.asset_class, t.country, holdingDays);

        realizedTrades.push({
          memberId: t.member_id,
          key: holdingKey(t),
          ticker: t.asset_ticker,
          isin: t.isin,
          currency: t.currency,
          country: t.country,
          assetClass: t.asset_class,
          sellDate: t.txn_date,
          buyDate: lot.date,
          quantity: consumeQty,
          proceedsNative: consumeQty * proceedsPerUnit,
          costBasisNative: consumeQty * lot.costPerUnit,
          gainNative: consumeQty * (proceedsPerUnit - lot.costPerUnit),
          holdingDays,
          classification,
          fy: fyLabel(t.txn_date),
        });

        lot.qty -= consumeQty;
        remaining -= consumeQty;
        if (lot.qty <= 1e-9) queue.shift();
      }
      // remaining > 0 here means a sell exceeded recorded holdings — see docstring.
    }

    lotsByGroup.set(groupKey, queue);
  }

  return { lotsByGroup, realizedTrades };
}
