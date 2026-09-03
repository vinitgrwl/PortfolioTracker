import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/server-utils";
import { computeHoldings, type Holding } from "@/lib/networth";
import { computeXirr, buildCashflowsByCurrency } from "@/lib/xirr";
import { computeRealizedPL, summarizeRealizedPL, summarizeDividends, type RealizedTrade } from "@/lib/realizedPL";
import { formatINR, formatUSD, formatPercent } from "@/lib/format";
import type { Transaction, ManualInstrument, LatestPrice, Member } from "@/lib/types";

export default async function ReturnsPage() {
  const supabase = await createClient();

  const [membersRes, transactions, instrumentsRes, pricesRes] = await Promise.all([
    supabase.from("members").select("*").order("name"),
    fetchAll<Transaction>(supabase, "transactions"),
    supabase.from("manual_instruments").select("*"),
    supabase.from("latest_prices").select("*"),
  ]);

  const members = (membersRes.data ?? []) as Member[];
  const instruments = (instrumentsRes.data ?? []) as ManualInstrument[];
  const prices = (pricesRes.data ?? []) as LatestPrice[];
  const memberById = new Map(members.map((m) => [m.id, m.name]));

  if (transactions.length === 0 && instruments.length === 0) {
    return (
      <div>
        <h1 className="figure-large text-2xl mb-6">Returns</h1>
        <p className="text-sm text-ink-soft">Nothing logged yet — add transactions or FDs/ULIPs first.</p>
      </div>
    );
  }

  const holdings = computeHoldings(transactions, prices);

  // ---- XIRR: family total + per member, INR and USD kept separate ----
  const familyCashflows = buildCashflowsByCurrency(transactions, instruments, holdings);
  const familyXirr = {
    INR: computeXirr(familyCashflows.INR),
    USD: computeXirr(familyCashflows.USD),
  };

  const perMemberXirr = members.map((m) => {
    const memberTxns = transactions.filter((t) => t.member_id === m.id);
    const memberInstruments = instruments.filter((i) => i.member_id === m.id);
    const memberHoldings = holdings.filter((h: Holding) => h.memberId === m.id);
    const cashflows = buildCashflowsByCurrency(memberTxns, memberInstruments, memberHoldings);
    return {
      member: m,
      INR: computeXirr(cashflows.INR),
      USD: computeXirr(cashflows.USD),
    };
  });

  // ---- Realized P&L: FIFO, FY-wise, STCG/LTCG/VDA ----
  const trades = computeRealizedPL(transactions);
  const summary = summarizeRealizedPL(trades);
  const dividends = summarizeDividends(transactions);

  const fys = Array.from(new Set([...summary.map((s) => s.fy), ...dividends.map((d) => d.fy)])).sort((a, b) =>
    b.localeCompare(a)
  );

  const tradesByFy = new Map<string, RealizedTrade[]>();
  for (const t of trades) {
    if (!tradesByFy.has(t.fy)) tradesByFy.set(t.fy, []);
    tradesByFy.get(t.fy)!.push(t);
  }

  return (
    <div>
      <h1 className="figure-large text-2xl mb-6">Returns</h1>

      <Section title="Portfolio returns (XIRR)">
        <p className="px-3 pt-3 text-xs text-ink-soft">
          Computed separately per currency (INR and USD holdings aren&rsquo;t blended — there&rsquo;s
          no historical FX rate stored per transaction, so a combined figure would be falsely precise).
        </p>
        <table className="ledger">
          <thead>
            <tr>
              <th>Member</th>
              <th className="text-right">INR XIRR</th>
              <th className="text-right">USD XIRR</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>Family total</strong>
              </td>
              <td className="num">{fmtXirr(familyXirr.INR)}</td>
              <td className="num">{fmtXirr(familyXirr.USD)}</td>
            </tr>
            {perMemberXirr.map((row) => (
              <tr key={row.member.id}>
                <td>{row.member.name}</td>
                <td className="num">{fmtXirr(row.INR)}</td>
                <td className="num">{fmtXirr(row.USD)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Realized P&L (FIFO, FY-wise)">
        <div className="px-3 pt-3 pb-1 text-xs text-ink-soft space-y-1">
          <p>
            Not tax advice — a starting point for your own filing, not a substitute for a CA&rsquo;s
            review.
          </p>
          <p>
            LTCG threshold: 12 months for Indian equity/ETF/Mutual Funds, 24 months for US stocks.
            Crypto is shown separately as VDA (flat 30% either way under Indian law, no LTCG benefit).
          </p>
          <p>
            Mutual Fund holding-period rules assume an equity fund — debt funds are actually always
            short-term post the 2023 tax amendment, but this app doesn&rsquo;t track equity vs debt
            fund type yet.
          </p>
          <p>Figures are in each holding&rsquo;s native currency — no FX conversion applied.</p>
        </div>

        {fys.length === 0 ? (
          <p className="px-3 py-4 text-sm text-ink-soft">No sell transactions yet — nothing realized.</p>
        ) : (
          fys.map((fy) => (
            <details key={fy} className="border-t border-rule" open={fy === fys[0]}>
              <summary className="px-3 py-3 text-sm cursor-pointer select-none">{fy}</summary>
              <div className="px-3 pb-4">
                <table className="ledger mb-3">
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Currency</th>
                      <th className="text-right">STCG</th>
                      <th className="text-right">LTCG</th>
                      <th className="text-right">VDA (crypto)</th>
                      <th className="text-right">Dividends</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary
                      .filter((s) => s.fy === fy)
                      .map((s) => {
                        const div = dividends.find(
                          (d) => d.fy === fy && d.memberId === s.memberId && d.currency === s.currency
                        );
                        const fmt = s.currency === "USD" ? formatUSD : (v: number) => formatINR(v, { showSign: false });
                        return (
                          <tr key={`${s.memberId}-${s.currency}`}>
                            <td>{memberById.get(s.memberId) ?? "—"}</td>
                            <td>{s.currency}</td>
                            <td className={`num ${s.stcg < 0 ? "text-loss" : ""}`}>{fmt(s.stcg)}</td>
                            <td className={`num ${s.ltcg < 0 ? "text-loss" : ""}`}>{fmt(s.ltcg)}</td>
                            <td className={`num ${s.vda < 0 ? "text-loss" : ""}`}>{fmt(s.vda)}</td>
                            <td className="num">{fmt(div?.total ?? 0)}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>

                <table className="ledger">
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Ticker</th>
                      <th>Bought</th>
                      <th>Sold</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Gain</th>
                      <th>Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(tradesByFy.get(fy) ?? [])
                      .sort((a, b) => b.sellDate.localeCompare(a.sellDate))
                      .map((t, i) => (
                        <tr key={i}>
                          <td>{memberById.get(t.memberId) ?? "—"}</td>
                          <td>{t.ticker}</td>
                          <td className="whitespace-nowrap">{t.buyDate}</td>
                          <td className="whitespace-nowrap">{t.sellDate}</td>
                          <td className="num">{t.quantity.toLocaleString("en-IN", { maximumFractionDigits: 4 })}</td>
                          <td className={`num ${t.gainNative < 0 ? "text-loss" : "text-gain"}`}>
                            {t.currency === "USD" ? formatUSD(t.gainNative) : formatINR(t.gainNative, { showSign: true })}
                          </td>
                          <td>{t.classification}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))
        )}
      </Section>
    </div>
  );
}

function fmtXirr(rate: number | null): string {
  if (rate === null) return "—";
  return formatPercent(rate * 100);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="text-sm text-ink-soft mb-2">{title}</h2>
      <div className="bg-paper-raised border border-rule">{children}</div>
    </div>
  );
}
