import { createClient } from "@/lib/supabase/server";
import { fetchAll, fetchEffectiveTransactions } from "@/lib/server-utils";
import { computeInvestedPerMonth } from "@/lib/investedPerMonth";
import InvestedPerMonthChart from "@/components/InvestedPerMonthChart";
import { formatINR, formatPercent } from "@/lib/format";
import type { CorporateAction, ManualInstrument, ExchangeRate } from "@/lib/types";

export default async function InvestedPerMonthPage() {
  const supabase = await createClient();

  const [transactions, corporateActions, instrumentsRes, snapshotsRes, rateRes] = await Promise.all([
    fetchEffectiveTransactions(supabase),
    fetchAll<CorporateAction>(supabase, "corporate_actions"),
    supabase.from("manual_instruments").select("*"),
    fetchAll<{ snapshot_date: string; total_inr: number }>(
      supabase,
      "net_worth_snapshots",
      "snapshot_date, total_inr"
    ),
    supabase.from("exchange_rates").select("*").eq("pair", "USD_INR").maybeSingle(),
  ]);

  const instruments = (instrumentsRes.data ?? []) as ManualInstrument[];
  const rate = rateRes.data as ExchangeRate | null;
  const usdInrRate = rate?.rate ?? 0;

  const points = computeInvestedPerMonth(transactions, corporateActions, instruments, usdInrRate, snapshotsRes);

  const monthsMissingSnapshot = points.filter((p) => p.currentINR === null).length;

  return (
    <div>
      <h1 className="figure-large text-2xl mb-2">Invested per month</h1>
      <p className="text-sm text-ink-soft max-w-md mb-6">
        Invested value is the cost basis of open positions as of each month&rsquo;s end
        (replayed from the transaction ledger). Current value comes from the daily net
        worth history on the Dashboard — run &ldquo;Build Full History&rdquo; there first
        if past months show a gap.
      </p>

      {usdInrRate === 0 && (
        <p className="text-xs text-loss mb-6">
          No USD→INR rate set yet — set one on the Prices page for accurate figures
          across currencies.
        </p>
      )}

      {monthsMissingSnapshot > 0 && (
        <p className="text-xs text-ink-soft mb-6">
          {monthsMissingSnapshot} month{monthsMissingSnapshot === 1 ? "" : "s"} without a net
          worth snapshot — current value and CAGR show as &ldquo;—&rdquo; there.
        </p>
      )}

      <Section title="Trend">
        <InvestedPerMonthChart data={points} />
      </Section>

      <Section title="By month">
        {points.length === 0 ? (
          <p className="px-3 py-4 text-sm text-ink-soft">No data yet.</p>
        ) : (
          <table className="ledger">
            <thead>
              <tr>
                <th>Month</th>
                <th className="text-right">Invested</th>
                <th className="text-right">Current value</th>
                <th className="text-right">CAGR</th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((p) => (
                <tr key={p.month}>
                  <td>{p.month}</td>
                  <td className="num">{formatINR(p.investedINR)}</td>
                  <td className="num">{p.currentINR !== null ? formatINR(p.currentINR) : "—"}</td>
                  <td className={`num ${p.cagrPct !== null ? (p.cagrPct >= 0 ? "text-gain" : "text-loss") : ""}`}>
                    {p.cagrPct !== null ? formatPercent(p.cagrPct) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="text-sm text-ink-soft mb-2">{title}</h2>
      <div className="bg-paper-raised border border-rule">{children}</div>
    </div>
  );
}
