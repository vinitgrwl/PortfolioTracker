import { createClient } from "@/lib/supabase/server";
import { fetchAll, fetchEffectiveTransactions } from "@/lib/server-utils";
import { computeHoldings } from "@/lib/networth";
import { computeSectorWise } from "@/lib/sectorWise";
import { formatINR, formatPercent } from "@/lib/format";
import type { LatestPrice, CorporateAction, ExchangeRate } from "@/lib/types";

export default async function SectorWisePage() {
  const supabase = await createClient();

  const [transactions, prices, corporateActions, rateRes] = await Promise.all([
    fetchEffectiveTransactions(supabase),
    fetchAll<LatestPrice>(supabase, "latest_prices"),
    fetchAll<CorporateAction>(supabase, "corporate_actions"),
    supabase.from("exchange_rates").select("*").eq("pair", "USD_INR").maybeSingle(),
  ]);

  const rate = rateRes.data as ExchangeRate | null;
  const usdInrRate = rate?.rate ?? 0;

  const holdings = computeHoldings(transactions, prices, corporateActions);
  const rows = computeSectorWise(holdings, usdInrRate);

  const untaggedCount = holdings.filter((h) => !h.sector || !h.sector.trim()).length;

  return (
    <div>
      <h1 className="figure-large text-2xl mb-2">Sector-wise</h1>
      <p className="text-sm text-ink-soft max-w-md mb-6">
        Stock/ETF/Crypto/Mutual Fund holdings grouped by the Sector tag on their
        transactions — FDs and ULIPs aren&rsquo;t sector-classified so they&rsquo;re
        left out here (see the dashboard for full net worth).
      </p>

      {usdInrRate === 0 && (
        <p className="text-xs text-loss mb-6">
          No USD→INR rate set yet — set one on the Prices page for accurate figures
          across currencies.
        </p>
      )}

      {untaggedCount > 0 && (
        <p className="text-xs text-ink-soft mb-6">
          {untaggedCount} holding{untaggedCount === 1 ? "" : "s"} untagged — grouped under
          &ldquo;Unclassified&rdquo;. Tag a Sector when logging or editing a transaction to
          split it out.
        </p>
      )}

      <Section title="By sector">
        {rows.length === 0 ? (
          <p className="px-3 py-4 text-sm text-ink-soft">No holdings yet.</p>
        ) : (
          <table className="ledger">
            <thead>
              <tr>
                <th>Sector</th>
                <th className="text-right">Invested</th>
                <th className="text-right">Current value</th>
                <th className="text-right">Unrealized</th>
                <th className="text-right">Dividends</th>
                <th className="text-right">% of holdings</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sector}>
                  <td>{r.sector}</td>
                  <td className="num">{formatINR(r.investedINR)}</td>
                  <td className="num">{formatINR(r.currentINR)}</td>
                  <td className={`num ${r.unrealizedINR >= 0 ? "text-gain" : "text-loss"}`}>
                    {formatINR(r.unrealizedINR, { showSign: true })}
                  </td>
                  <td className="num">{formatINR(r.dividendINR)}</td>
                  <td className="num">{formatPercent(r.pctOfHoldings).replace("+", "")}</td>
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
