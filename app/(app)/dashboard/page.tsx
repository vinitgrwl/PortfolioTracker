import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/server-utils";
import { computeHoldings, computeNetWorth } from "@/lib/networth";
import { formatINR, formatPercent } from "@/lib/format";
import { refreshLivePrices } from "@/lib/actions-prices";
import { ensureTodaySnapshot, buildNetWorthHistoryAction } from "@/lib/actions-history";
import NetWorthTrendChart from "@/components/NetWorthTrendChart";
import AllocationChart from "@/components/AllocationChart";
import type { Transaction, ManualInstrument, LatestPrice, CorporateAction, Member } from "@/lib/types";
import Link from "next/link";
import { after } from "next/server";

export default async function DashboardPage() {
  const supabase = await createClient();

  // Price refresh moved off the render path: it used to be awaited here,
  // blocking the page on Yahoo/CoinGecko/AMFI calls (AMFI's full NAV file
  // alone can take a couple of seconds) before a single row of data had
  // even been fetched. `after()` runs it once the response has been sent,
  // so this load renders with whatever prices are already in the DB
  // (up to 5 min stale) and the next load gets the freshly refreshed ones.
  after(async () => {
    try {
      await refreshLivePrices();
    } catch {
      // best-effort — same as before, just no longer on the render path
    }
  });

  const [membersRes, transactions, instrumentsRes, pricesRes, rateRes, corporateActions] = await Promise.all([
    supabase.from("members").select("*").order("name"),
    fetchAll<Transaction>(supabase, "transactions"),
    supabase.from("manual_instruments").select("*"),
    supabase.from("latest_prices").select("*"),
    supabase.from("exchange_rates").select("*").eq("pair", "USD_INR").maybeSingle(),
    fetchAll<CorporateAction>(supabase, "corporate_actions"),
  ]);

  const members = (membersRes.data ?? []) as Member[];
  const instruments = (instrumentsRes.data ?? []) as ManualInstrument[];
  const prices = (pricesRes.data ?? []) as LatestPrice[];
  const usdInrRate = rateRes.data?.rate ?? null;


  const memberById = new Map(members.map((m) => [m.id, m.name]));

  if (members.length === 0) {
    return (
      <EmptyState
        title="No members added yet"
        body="Add each family member first, then log their holdings and FDs against them."
        cta={{ href: "/transactions", label: "Add a member" }}
      />
    );
  }

  const holdings = computeHoldings(transactions, prices, corporateActions);
  const breakdown = computeNetWorth(holdings, instruments, usdInrRate ?? 0);

  const hasEquityHoldings = holdings.length > 0;
  const hasAnyValue = transactions.length > 0 || instruments.length > 0;

  // Best-effort: add today's point to the trend if it's missing. Cheap —
  // reuses the total we already computed above, no extra API calls.
  if (hasAnyValue) {
    try {
      await ensureTodaySnapshot(breakdown.totalINR);
    } catch {
      // ignore — trend chart just won't have today's point yet
    }
  }

  const snapshotsRes = await supabase
    .from("net_worth_snapshots")
    .select("snapshot_date, total_inr")
    .order("snapshot_date", { ascending: true });
  const snapshots = (snapshotsRes.data ?? []) as { snapshot_date: string; total_inr: number }[];

  return (
    <div>
      <h1 className="text-sm text-ink-soft mb-1">Consolidated net worth</h1>
      <div className="figure-large text-4xl md:text-5xl text-brass mb-1">
        {usdInrRate === null && hasEquityHoldings ? "—" : formatINR(breakdown.totalINR)}
      </div>
      <div className="text-sm text-ink-soft mb-8">
        Invested {formatINR(breakdown.investedINR)} ·{" "}
        <span className={breakdown.unrealizedPLINR >= 0 ? "text-gain" : "text-loss"}>
          {formatINR(breakdown.unrealizedPLINR, { showSign: true })}
        </span>{" "}
        unrealized
      </div>

      {!hasAnyValue && (
        <EmptyState
          title="Nothing logged yet"
          body="Add a transaction or an FD/ULIP to see the net worth build up here."
          cta={{ href: "/transactions", label: "Add a transaction" }}
        />
      )}

      {usdInrRate === null && hasEquityHoldings && (
        <Notice>
          USD→INR rate isn&rsquo;t set — US holdings can&rsquo;t be converted into the total yet.{" "}
          <Link href="/prices" className="underline">
            Set it on the Prices page
          </Link>
          .
        </Notice>
      )}

      {breakdown.priceGapsCount > 0 && (
        <Notice>
          {breakdown.priceGapsCount} holding{breakdown.priceGapsCount > 1 ? "s" : ""} missing a
          current price — invested value is counted, current value isn&rsquo;t.{" "}
          <Link href="/prices" className="underline">
            Enter prices
          </Link>
          .
        </Notice>
      )}

      {hasAnyValue && (
        <>
          <div className="mb-8">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm text-ink-soft">Net worth trend</h2>
              <form action={buildNetWorthHistoryAction}>
                <button type="submit" className="text-xs text-ink-soft underline hover:text-ink">
                  Build Full History
                </button>
              </form>
            </div>
            <div className="bg-paper-raised border border-rule">
              <NetWorthTrendChart data={snapshots} />
            </div>
            <p className="text-xs text-ink-soft mt-1">
              &ldquo;Build Full History&rdquo; reconstructs past points from your transaction
              ledger and historical prices — it can take a little while and only needs to be run
              once (or after adding a lot of old transactions).
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6 mb-8">
            <AllocationChart
              title="Allocation by asset type"
              data={Object.entries(breakdown.byAssetType).map(([type, row]) => ({
                name: type,
                value: row.currentINR,
              }))}
            />
            <AllocationChart
              title="Allocation by country"
              data={Object.entries(breakdown.byCountry).map(([country, row]) => ({
                name: country,
                value: row.currentINR,
              }))}
            />
          </div>

          <Section title="By member">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Member</th>
                  <th className="text-right">Invested</th>
                  <th className="text-right">Current</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const row = breakdown.byMember[m.id];
                  if (!row) return null;
                  return (
                    <tr key={m.id}>
                      <td>{m.name}</td>
                      <td className="num">{formatINR(row.investedINR)}</td>
                      <td className="num">{formatINR(row.currentINR)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>

          <Section title="By asset type">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Type</th>
                  <th className="text-right">Invested</th>
                  <th className="text-right">Current</th>
                  <th className="text-right">Share</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(breakdown.byAssetType).map(([type, row]) => (
                  <tr key={type}>
                    <td>{type}</td>
                    <td className="num">{formatINR(row.investedINR)}</td>
                    <td className="num">{formatINR(row.currentINR)}</td>
                    <td className="num">
                      {breakdown.totalINR > 0
                        ? formatPercent((row.currentINR / breakdown.totalINR) * 100).replace("+", "")
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          {Object.keys(breakdown.byCountry).length > 0 && (
            <Section title="By country">
              <table className="ledger">
                <thead>
                  <tr>
                    <th>Country</th>
                    <th className="text-right">Current</th>
                    <th className="text-right">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(breakdown.byCountry).map(([country, row]) => (
                    <tr key={country}>
                      <td>{country}</td>
                      <td className="num">{formatINR(row.currentINR)}</td>
                      <td className="num">
                        {breakdown.totalINR > 0
                          ? formatPercent((row.currentINR / breakdown.totalINR) * 100).replace("+", "")
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          <Section title="Holdings">
            {holdings.length === 0 ? (
              <p className="text-sm text-ink-soft">No open equity/crypto/MF positions.</p>
            ) : (
              <table className="ledger">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Company</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Avg cost</th>
                    <th className="text-right">Current</th>
                    <th className="text-right">P/L</th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((h) => {
                    const pl =
                      h.currentValue !== null ? h.currentValue - h.investedValue : null;
                    return (
                      <tr key={`${h.memberId}-${h.key}`}>
                        <td>{memberById.get(h.memberId) ?? "—"}</td>
                        <td>
                          <div>{h.assetName || h.assetTicker}</div>
                          {h.assetName && <div className="text-xs text-ink-soft">{h.assetTicker}</div>}
                        </td>
                        <td className="num">{h.quantity.toLocaleString("en-IN", { maximumFractionDigits: 4 })}</td>
                        <td className="num">
                          {h.currency === "USD" ? "$" : "₹"}
                          {h.avgCost.toFixed(2)}
                        </td>
                        <td className="num">
                          {h.currentValue !== null
                            ? `${h.currency === "USD" ? "$" : "₹"}${h.currentValue.toFixed(2)}`
                            : "—"}
                        </td>
                        <td className={`num ${pl !== null && pl < 0 ? "text-loss" : "text-gain"}`}>
                          {pl !== null
                            ? `${pl >= 0 ? "+" : ""}${h.currency === "USD" ? "$" : "₹"}${pl.toFixed(2)}`
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Section>

          {instruments.length > 0 && (
            <Section title="FDs & ULIPs">
              <table className="ledger">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Instrument</th>
                    <th className="text-right">Invested</th>
                    <th className="text-right">Current</th>
                  </tr>
                </thead>
                <tbody>
                  {instruments.map((inst) => (
                    <tr key={inst.id}>
                      <td>{memberById.get(inst.member_id) ?? "—"}</td>
                      <td>
                        {inst.label} <span className="text-ink-soft text-xs">({inst.asset_type})</span>
                      </td>
                      <td className="num">{formatINR(inst.invested_amount)}</td>
                      <td className="num">
                        {formatINR(
                          inst.asset_type === "FD"
                            ? computeInstrumentPreview(inst)
                            : inst.current_value ?? inst.invested_amount
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function computeInstrumentPreview(inst: ManualInstrument): number {
  if (!inst.start_date || inst.rate === null) return inst.invested_amount;
  const start = new Date(inst.start_date);
  const cap = inst.maturity_date ? new Date(inst.maturity_date) : null;
  const now = new Date();
  const effectiveNow = cap && now > cap ? cap : now;
  const years = Math.max(
    0,
    (effectiveNow.getTime() - start.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
  );
  const r = inst.rate / 100;
  return inst.invested_amount * Math.pow(1 + r / 4, 4 * years);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="text-sm text-ink-soft mb-2">{title}</h2>
      <div className="bg-paper-raised border border-rule px-1">{children}</div>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-paper-raised border border-brass-soft text-sm px-4 py-3 mb-6">
      {children}
    </div>
  );
}

function EmptyState({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta: { href: string; label: string };
}) {
  return (
    <div className="bg-paper-raised border border-rule px-6 py-10 text-center">
      <div className="figure-large text-lg mb-2">{title}</div>
      <p className="text-sm text-ink-soft mb-5 max-w-sm mx-auto">{body}</p>
      <Link
        href={cta.href}
        className="inline-block bg-ink text-paper-raised text-sm px-4 py-2"
      >
        {cta.label}
      </Link>
    </div>
  );
}
