import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/server-utils";
import { computeHoldings } from "@/lib/networth";
import { computeRealizedPL } from "@/lib/realizedPL";
import { listScreenerOptions, computeScreenerSummary } from "@/lib/screener";
import { fetchYahooWatchlistQuote, fetchYahooCompanySnapshot, toYahooSymbol } from "@/lib/priceFeeds";
import { formatINR, formatPercent, formatQty } from "@/lib/format";
import ScreenerPicker from "@/components/ScreenerPicker";
import type { Member, Transaction, LatestPrice, CorporateAction, ExchangeRate } from "@/lib/types";

export default async function ScreenerPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string }>;
}) {
  const { key: selectedKey } = await searchParams;
  const supabase = await createClient();

  const [membersRes, transactions, prices, corporateActions, rateRes] = await Promise.all([
    supabase.from("members").select("*").order("name"),
    fetchAll<Transaction>(supabase, "transactions"),
    fetchAll<LatestPrice>(supabase, "latest_prices"),
    fetchAll<CorporateAction>(supabase, "corporate_actions"),
    supabase.from("exchange_rates").select("*").eq("pair", "USD_INR").maybeSingle(),
  ]);

  const members = (membersRes.data ?? []) as Member[];
  const usdInrRate = (rateRes.data as ExchangeRate | null)?.rate ?? 0;

  const options = listScreenerOptions(transactions);
  const activeKey = selectedKey ?? options[0]?.key ?? null;

  const holdings = computeHoldings(transactions, prices, corporateActions);
  const realizedTrades = computeRealizedPL(transactions, corporateActions);

  const summary = activeKey
    ? computeScreenerSummary(activeKey, holdings, realizedTrades, transactions, members, usdInrRate)
    : null;

  // Live company snapshot — best-effort, stock/ETF only (crypto/MF don't
  // have a P/E, market cap in the usual sense, etc.).
  let snapshot: Awaited<ReturnType<typeof fetchYahooCompanySnapshot>> = null;
  let quote: Awaited<ReturnType<typeof fetchYahooWatchlistQuote>> = null;
  if (summary && (summary.assetClass === "Stock" || summary.assetClass === "ETF")) {
    const symbol = toYahooSymbol(summary.ticker, summary.country);
    [snapshot, quote] = await Promise.all([fetchYahooCompanySnapshot(symbol), fetchYahooWatchlistQuote(symbol)]);
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-2 flex-wrap">
        <h1 className="figure-large text-2xl">Screener</h1>
      </div>
      <p className="text-sm text-ink-soft max-w-md mb-6">
        Every number here is across all members and platforms combined for this one security. Company
        snapshot fields (market cap, P/E, sector) are best-effort — Yahoo blocks this particular lookup
        more often than the one used for prices, so a &ldquo;—&rdquo; there doesn&rsquo;t mean anything is wrong.
      </p>

      {options.length === 0 ? (
        <p className="px-3 py-4 text-sm text-ink-soft">No transactions logged yet.</p>
      ) : (
        <>
          <div className="mb-6">
            <label className="block text-xs text-ink-soft mb-1">Security</label>
            <ScreenerPicker options={options} activeKey={activeKey} />
          </div>

          {summary && (
            <>
              <Section title={`${summary.assetName ?? summary.ticker} (${summary.ticker})`}>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-rule">
                  <Metric label="Cost" value={formatINR(summary.investedINR)} />
                  <Metric
                    label="Current value"
                    value={summary.currentINR !== null ? formatINR(summary.currentINR) : "—"}
                  />
                  <Metric
                    label="Unrealized ROI"
                    value={summary.unrealizedROIPct !== null ? formatPercent(summary.unrealizedROIPct) : "—"}
                    tone={summary.unrealizedROIPct !== null ? (summary.unrealizedROIPct >= 0 ? "gain" : "loss") : undefined}
                  />
                  <Metric
                    label="Unrealized P/L"
                    value={summary.unrealizedPLINR !== null ? formatINR(summary.unrealizedPLINR, { showSign: true }) : "—"}
                    tone={summary.unrealizedPLINR !== null ? (summary.unrealizedPLINR >= 0 ? "gain" : "loss") : undefined}
                  />
                  <Metric
                    label="Realized P/L"
                    value={formatINR(summary.realizedPLINR, { showSign: true })}
                    tone={summary.realizedPLINR >= 0 ? "gain" : "loss"}
                  />
                  <Metric label="Dividend" value={formatINR(summary.dividendINR)} />
                  <Metric
                    label="Total P/L"
                    value={summary.totalPLINR !== null ? formatINR(summary.totalPLINR, { showSign: true }) : "—"}
                    tone={summary.totalPLINR !== null ? (summary.totalPLINR >= 0 ? "gain" : "loss") : undefined}
                  />
                  <Metric
                    label="Current price"
                    value={
                      summary.currentPriceNative !== null
                        ? `${summary.currency === "USD" ? "$" : "₹"}${summary.currentPriceNative}`
                        : "—"
                    }
                  />
                </div>
                <p className="px-3 py-2 text-xs text-ink-soft">
                  Currently holding {formatQty(summary.quantity)} units.
                </p>
              </Section>

              {(summary.assetClass === "Stock" || summary.assetClass === "ETF") && (
                <Section title="Company snapshot">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-rule">
                    <Metric label="Sector" value={snapshot?.sector ?? "—"} />
                    <Metric label="Market cap" value={snapshot?.marketCap !== null && snapshot?.marketCap !== undefined ? formatCompactINR(snapshot.marketCap) : "—"} />
                    <Metric label="Volume" value={snapshot?.volume !== null && snapshot?.volume !== undefined ? snapshot.volume.toLocaleString("en-IN") : "—"} />
                    <Metric label="P/E ratio" value={snapshot?.peRatio !== null && snapshot?.peRatio !== undefined ? snapshot.peRatio.toFixed(2) : "—"} />
                    <Metric label="EPS" value={snapshot?.eps !== null && snapshot?.eps !== undefined ? snapshot.eps.toFixed(2) : "—"} />
                    <Metric label="Beta" value={snapshot?.beta !== null && snapshot?.beta !== undefined ? snapshot.beta.toFixed(2) : "—"} />
                    <Metric label="52w High" value={quote?.fiftyTwoWeekHigh !== null && quote?.fiftyTwoWeekHigh !== undefined ? quote.fiftyTwoWeekHigh.toLocaleString("en-IN") : "—"} />
                    <Metric label="52w Low" value={quote?.fiftyTwoWeekLow !== null && quote?.fiftyTwoWeekLow !== undefined ? quote.fiftyTwoWeekLow.toLocaleString("en-IN") : "—"} />
                  </div>
                </Section>
              )}

              <Section title={`Holdings by account (${summary.byPlatform.length})`}>
                {summary.byPlatform.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-ink-soft">No open position.</p>
                ) : (
                  <table className="ledger">
                    <thead>
                      <tr>
                        <th>Member</th>
                        <th>Platform</th>
                        <th className="text-right">Quantity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.byPlatform.map((p) => (
                        <tr key={`${p.memberId}::${p.platform}`}>
                          <td>{p.memberName}</td>
                          <td>{p.platform}</td>
                          <td className="num">{formatQty(p.quantity)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Section>

              <Section title={`All trades (${summary.trades.length})`}>
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Member</th>
                      <th>Action</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Price</th>
                      <th>Platform</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.trades.map((t) => (
                      <tr key={t.id}>
                        <td className="whitespace-nowrap">{t.txn_date}</td>
                        <td>{members.find((m) => m.id === t.member_id)?.name ?? "—"}</td>
                        <td className="capitalize">{t.action}</td>
                        <td className="num">{t.action === "dividend" ? "—" : formatQty(t.quantity)}</td>
                        <td className="num">
                          {t.currency === "USD" ? "$" : "₹"}
                          {t.price}
                        </td>
                        <td>{t.platform}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>
            </>
          )}
        </>
      )}
    </div>
  );
}

function formatCompactINR(value: number): string {
  if (value >= 1e7) return `₹${(value / 1e7).toFixed(0)} Cr`;
  if (value >= 1e5) return `₹${(value / 1e5).toFixed(0)} L`;
  return formatINR(value);
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "gain" | "loss" }) {
  return (
    <div className="bg-paper-raised px-3 py-3">
      <div className="text-xs text-ink-soft">{label}</div>
      <div className={`figure-large text-lg ${tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : ""}`}>
        {value}
      </div>
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
