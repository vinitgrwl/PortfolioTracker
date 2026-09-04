import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fetchAll, fetchEffectiveTransactions } from "@/lib/server-utils";
import { computeHoldings } from "@/lib/networth";
import { computeRebalancing } from "@/lib/rebalancing";
import {
  upsertClassTarget,
  deleteClassTarget,
  upsertTickerTarget,
  deleteTickerTarget,
} from "@/lib/actions-rebalancing";
import type {
  Member,
  LatestPrice,
  CorporateAction,
  ManualInstrument,
  AssetClassTarget,
  TickerTarget,
  ExchangeRate,
} from "@/lib/types";

const ALL_CLASSES = ["Stock", "ETF", "Crypto", "Mutual Fund", "FD", "ULIP"];
const TICKER_CLASSES = ["Stock", "ETF", "Crypto", "Mutual Fund"];

export default async function RebalancingPage({
  searchParams,
}: {
  searchParams: Promise<{ member?: string }>;
}) {
  const { member: memberParam } = await searchParams;
  const memberId = memberParam && memberParam !== "all" ? memberParam : null;

  const supabase = await createClient();

  const [
    membersRes,
    transactions,
    prices,
    corporateActions,
    instrumentsRes,
    classTargetsRes,
    tickerTargetsRes,
    rateRes,
  ] = await Promise.all([
    supabase.from("members").select("*").order("name"),
    fetchEffectiveTransactions(supabase),
    fetchAll<LatestPrice>(supabase, "latest_prices"),
    fetchAll<CorporateAction>(supabase, "corporate_actions"),
    fetchAll<ManualInstrument>(supabase, "manual_instruments"),
    fetchAll<AssetClassTarget>(supabase, "asset_class_targets"),
    fetchAll<TickerTarget>(supabase, "ticker_targets"),
    supabase.from("exchange_rates").select("*").eq("pair", "USD_INR").maybeSingle(),
  ]);

  const members = (membersRes.data ?? []) as Member[];
  const instruments = instrumentsRes;
  const classTargets = classTargetsRes;
  const tickerTargets = tickerTargetsRes;
  const rate = rateRes.data as ExchangeRate | null;
  const usdInrRate = rate?.rate ?? 0;

  const holdings = computeHoldings(transactions, prices, corporateActions);
  const result = computeRebalancing(holdings, instruments, classTargets, tickerTargets, usdInrRate, memberId);

  const targetSum = classTargets.reduce((sum, t) => sum + t.target_weight_pct, 0);

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-2 flex-wrap">
        <h1 className="figure-large text-2xl">Rebalancing</h1>
        <div className="flex gap-1 text-sm">
          <ViewLink href="/rebalancing?member=all" active={!memberId} label="Family-wide" />
          {members.map((m) => (
            <ViewLink key={m.id} href={`/rebalancing?member=${m.id}`} active={memberId === m.id} label={m.name} />
          ))}
        </div>
      </div>
      <p className="text-sm text-ink-soft max-w-md mb-6">
        Target weights are set once and shared across both views — only the
        &ldquo;actual&rdquo; column changes when you switch between family-wide and
        per-member.
      </p>

      {usdInrRate === 0 && (
        <p className="text-xs text-loss mb-6">
          No USD→INR rate set yet — set one on the Prices page for accurate weights
          across currencies.
        </p>
      )}

      {targetSum > 0 && Math.abs(targetSum - 100) > 0.5 && (
        <p className="text-xs text-loss mb-6">
          Asset-class targets sum to {targetSum.toFixed(1)}%, not 100% — weights below
          will still compute, but consider tidying the targets.
        </p>
      )}

      {result.nextPurchase && (
        <Section title="Next purchase recommended">
          <div className="px-3 py-3 text-sm">
            {result.nextPurchase.level === "ticker" ? (
              <>
                <span className="figure-large text-brass">{result.nextPurchase.assetTicker}</span>{" "}
                <span className="text-ink-soft">
                  ({result.nextPurchase.assetClass}) — {Math.abs(result.nextPurchase.deltaPct).toFixed(1)}pp
                  under target
                </span>
              </>
            ) : (
              <>
                <span className="figure-large text-brass">{result.nextPurchase.assetClass}</span>{" "}
                <span className="text-ink-soft">
                  — {Math.abs(result.nextPurchase.deltaPct).toFixed(1)}pp under target overall
                </span>
              </>
            )}
          </div>
        </Section>
      )}

      <Section title="Asset-class targets (% of total portfolio)">
        <table className="ledger">
          <thead>
            <tr>
              <th>Class</th>
              <th className="text-right">Target %</th>
              <th className="text-right">Actual %</th>
              <th className="text-right">Δ</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {result.classes.map((c) => (
              <tr key={c.assetClass}>
                <td>{c.assetClass}</td>
                <td className="num">{c.targetPct !== null ? c.targetPct.toFixed(1) : "—"}</td>
                <td className="num">{c.actualPct.toFixed(1)}</td>
                <td className={`num ${c.deltaPct !== null ? (c.deltaPct < 0 ? "text-loss" : "text-gain") : ""}`}>
                  {c.deltaPct !== null ? `${c.deltaPct >= 0 ? "+" : ""}${c.deltaPct.toFixed(1)}` : "—"}
                </td>
                <td>{c.status}</td>
                <td />
              </tr>
            ))}
          </tbody>
        </table>
        <form action={upsertClassTarget} className="px-3 py-4 flex items-end gap-3 border-t border-rule">
          <Field label="Class">
            <select name="asset_class" required className="input">
              {ALL_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Target %">
            <input type="number" step="any" name="target_weight_pct" required className="input w-24" />
          </Field>
          <button type="submit" className="bg-ink text-paper-raised text-sm px-4 py-1.5">
            Set target
          </button>
        </form>
      </Section>

      {classTargets.length > 0 && (
        <Section title="Remove a class target">
          <div className="px-3 py-3 flex flex-wrap gap-2">
            {classTargets.map((t) => (
              <form key={t.id} action={deleteClassTarget}>
                <input type="hidden" name="id" value={t.id} />
                <button
                  type="submit"
                  className="text-xs bg-white border border-rule px-2 py-1 hover:border-loss hover:text-loss"
                >
                  {t.asset_class} ({t.target_weight_pct}%) ×
                </button>
              </form>
            ))}
          </div>
        </Section>
      )}

      {TICKER_CLASSES.map((cls) => {
        const rows = result.tickersByClass[cls];
        if (!rows || rows.length === 0) return null;
        return (
          <Section key={cls} title={`${cls} — ticker targets (% within ${cls})`}>
            <table className="ledger">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th className="text-right">Target %</th>
                  <th className="text-right">Actual %</th>
                  <th className="text-right">Δ</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.assetTicker}>
                    <td>{r.assetTicker}</td>
                    <td className="num">{r.targetPct !== null ? r.targetPct.toFixed(1) : "—"}</td>
                    <td className="num">{r.actualPct.toFixed(1)}</td>
                    <td className={`num ${r.deltaPct !== null ? (r.deltaPct < 0 ? "text-loss" : "text-gain") : ""}`}>
                      {r.deltaPct !== null ? `${r.deltaPct >= 0 ? "+" : ""}${r.deltaPct.toFixed(1)}` : "—"}
                    </td>
                    <td>{r.status}</td>
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        );
      })}

      <Section title="Set a ticker target">
        <form action={upsertTickerTarget} className="px-3 py-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Class">
            <select name="asset_class" required className="input">
              {TICKER_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Ticker">
            <input name="asset_ticker" placeholder="AAPL, RELIANCE…" required className="input" />
          </Field>
          <Field label="Target % (within class)">
            <input type="number" step="any" name="target_weight_pct" required className="input" />
          </Field>
          <div className="flex items-end">
            <button type="submit" className="bg-ink text-paper-raised text-sm px-4 py-1.5">
              Set target
            </button>
          </div>
        </form>
      </Section>

      {tickerTargets.length > 0 && (
        <Section title="Remove a ticker target">
          <div className="px-3 py-3 flex flex-wrap gap-2">
            {tickerTargets.map((t) => (
              <form key={t.id} action={deleteTickerTarget}>
                <input type="hidden" name="id" value={t.id} />
                <button
                  type="submit"
                  className="text-xs bg-white border border-rule px-2 py-1 hover:border-loss hover:text-loss"
                >
                  {t.asset_ticker} ({t.asset_class}, {t.target_weight_pct}%) ×
                </button>
              </form>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function ViewLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 border border-rule ${
        active ? "bg-ink text-paper-raised" : "bg-paper-raised text-ink-soft hover:text-ink"
      }`}
    >
      {label}
    </Link>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-ink-soft">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}
