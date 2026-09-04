import type { Transaction, ManualInstrument, CorporateAction, Currency } from "./types";
import { replayLots, holdingKey } from "./lots";
import { toINR } from "./networth";

export interface MonthlyPoint {
  month: string; // "YYYY-MM"
  investedINR: number;
  currentINR: number | null; // null when no net-worth snapshot exists on/before this month
  cagrPct: number | null; // inception-to-date, annualized; null when not computable yet
}

function lastDayOfMonth(year: number, month1to12: number): string {
  // day 0 of next month = last day of this month
  const d = new Date(Date.UTC(year, month1to12, 0));
  return d.toISOString().slice(0, 10);
}

function monthsBetween(startYYYYMM: string, endYYYYMM: string): string[] {
  const [sy, sm] = startYYYYMM.split("-").map(Number);
  const [ey, em] = endYYYYMM.split("-").map(Number);
  const months: string[] = [];
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

/** Cost basis (invested value) of open positions as of a given date,
 *  by replaying the ledger up to that date — reuses the same FIFO lot
 *  logic as Holdings/Realized P&L, just bounded to an earlier cutoff. */
function investedINRAsOf(
  transactions: Transaction[],
  corporateActions: CorporateAction[],
  cutoffDate: string,
  usdInrRate: number
): number {
  const txnsUpTo = transactions.filter((t) => t.txn_date <= cutoffDate);
  const actionsUpTo = corporateActions.filter((a) => a.ex_date <= cutoffDate);
  if (txnsUpTo.length === 0) return 0;

  const currencyByKey = new Map<string, Currency>();
  for (const t of txnsUpTo) {
    const key = `${t.member_id}::${holdingKey(t)}`;
    if (!currencyByKey.has(key)) currencyByKey.set(key, t.currency);
  }

  const { lotsByGroup } = replayLots(txnsUpTo, actionsUpTo);

  let totalINR = 0;
  for (const [groupKey, lots] of lotsByGroup) {
    const currency = currencyByKey.get(groupKey) ?? "INR";
    const investedNative = lots.reduce((sum, l) => sum + l.qty * l.costPerUnit, 0);
    totalINR += toINR(investedNative, currency, usdInrRate);
  }
  return totalINR;
}

export function computeInvestedPerMonth(
  transactions: Transaction[],
  corporateActions: CorporateAction[],
  instruments: ManualInstrument[],
  usdInrRate: number,
  snapshots: { snapshot_date: string; total_inr: number }[],
  asOf: Date = new Date()
): MonthlyPoint[] {
  if (transactions.length === 0 && instruments.length === 0) return [];

  const earliestTxnDate = transactions.reduce(
    (min, t) => (t.txn_date < min ? t.txn_date : min),
    transactions[0]?.txn_date ?? "9999-12-31"
  );
  const earliestInstDate = instruments.reduce((min, i) => {
    const d = i.start_date ?? i.created_at.slice(0, 10);
    return d < min ? d : min;
  }, instruments[0] ? instruments[0].start_date ?? instruments[0].created_at.slice(0, 10) : "9999-12-31");
  const earliestDate = [earliestTxnDate, earliestInstDate].filter((d) => d !== "9999-12-31").sort()[0];
  if (!earliestDate) return [];

  const startMonth = earliestDate.slice(0, 7);
  const todayStr = asOf.toISOString().slice(0, 10);
  const endMonth = todayStr.slice(0, 7);
  const months = monthsBetween(startMonth, endMonth);

  const sortedSnapshots = [...snapshots].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));

  const points: MonthlyPoint[] = [];

  for (const month of months) {
    const [y, m] = month.split("-").map(Number);
    const monthEndCandidate = lastDayOfMonth(y, m);
    const monthEnd = monthEndCandidate > todayStr ? todayStr : monthEndCandidate;

    let investedINR = investedINRAsOf(transactions, corporateActions, monthEnd, usdInrRate);
    for (const inst of instruments) {
      const inclusionDate = inst.start_date ?? inst.created_at.slice(0, 10);
      if (inclusionDate > monthEnd) continue;
      investedINR += toINR(inst.invested_amount, inst.currency, usdInrRate);
    }

    // last snapshot on/before this month's end
    let currentINR: number | null = null;
    for (let i = sortedSnapshots.length - 1; i >= 0; i--) {
      if (sortedSnapshots[i].snapshot_date <= monthEnd) {
        currentINR = sortedSnapshots[i].total_inr;
        break;
      }
    }

    const years =
      (new Date(`${monthEnd}T00:00:00Z`).getTime() - new Date(`${earliestDate}T00:00:00Z`).getTime()) /
      (365.25 * 24 * 60 * 60 * 1000);
    const cagrPct =
      currentINR !== null && investedINR > 0 && currentINR > 0 && years > 0.08
        ? (Math.pow(currentINR / investedINR, 1 / years) - 1) * 100
        : null;

    points.push({ month, investedINR, currentINR, cagrPct });
  }

  return points;
}
