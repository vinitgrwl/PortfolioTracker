import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/server-utils";
import { upsertPrice, deletePrice, upsertExchangeRate } from "@/lib/actions";
import { refreshLivePrices, refreshLivePricesAction } from "@/lib/actions-prices";
import { resolveEffectiveIdentity } from "@/lib/companyEvents";
import type { LatestPrice, Transaction, CompanyEvent, ExchangeRate } from "@/lib/types";

export default async function PricesPage() {
  const supabase = await createClient();

  // Best-effort auto-refresh (skips symbols priced within the last 5 min).
  let refreshError: string | null = null;
  try {
    await refreshLivePrices();
  } catch (e) {
    refreshError = e instanceof Error ? e.message : "Live price refresh failed";
  }

  const [pricesRes, transactions, companyEvents, rateRes] = await Promise.all([
    supabase.from("latest_prices").select("*").order("updated_at", { ascending: false }),
    fetchAll<Pick<Transaction, "asset_ticker" | "isin" | "currency" | "country">>(
      supabase,
      "transactions",
      "asset_ticker, isin, currency, country"
    ),
    fetchAll<CompanyEvent>(supabase, "company_events"),
    supabase.from("exchange_rates").select("*").eq("pair", "USD_INR").maybeSingle(),
  ]);

  const prices = (pricesRes.data ?? []) as LatestPrice[];
  const rate = rateRes.data as ExchangeRate | null;

  // Resolve every held ticker to its CURRENT identity (renames/mergers)
  // before checking for a price — otherwise a renamed/merged security
  // sits in "Missing prices" forever, since its old symbol no longer
  // exists on Yahoo/wherever.
  const effectiveHeld = transactions.map((t) => resolveEffectiveIdentity(t.asset_ticker, t.isin, t.country, companyEvents));

  const pricedKeys = new Set(prices.map((p) => `${p.asset_ticker}::${p.currency}`));
  const tickersHeld = Array.from(
    new Map(
      effectiveHeld.map((t) => {
        const currency = t.country === "India" ? "INR" : "USD";
        return [`${t.ticker}::${currency}`, { asset_ticker: t.ticker, currency }];
      })
    ).values()
  );
  const missing = tickersHeld.filter((t) => !pricedKeys.has(`${t.asset_ticker}::${t.currency}`));

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="figure-large text-2xl mb-2">Prices</h1>
          <p className="text-sm text-ink-soft max-w-md">
            Stocks, crypto, mutual fund NAVs and the USD/INR rate refresh automatically
            (at most once every 5 minutes) whenever this page loads. Anything that
            couldn&rsquo;t be auto-matched — or isn&rsquo;t covered yet — shows up below
            for manual entry.
          </p>
        </div>
        <form action={refreshLivePricesAction}>
          <button type="submit" className="bg-ink text-paper-raised text-sm px-4 py-2 whitespace-nowrap">
            Refresh Now
          </button>
        </form>
      </div>

      {refreshError && (
        <p className="text-xs text-loss mb-6">Live refresh hit an issue: {refreshError}</p>
      )}

      <Section title="USD → INR rate">
        <form action={upsertExchangeRate} className="px-3 py-4 flex items-end gap-3">
          <Field label="1 USD = ₹">
            <input
              type="number"
              step="any"
              name="rate"
              defaultValue={rate?.rate ?? undefined}
              required
              className="input w-32"
            />
          </Field>
          <button type="submit" className="bg-ink text-paper-raised text-sm px-4 py-1.5">
            Save
          </button>
          {rate && (
            <span className="text-xs text-ink-soft mb-1.5">
              updated {new Date(rate.updated_at).toLocaleDateString("en-IN")}
            </span>
          )}
        </form>
      </Section>

      {missing.length > 0 && (
        <Section title="Missing prices">
          <div className="px-3 py-3">
            <p className="text-xs text-ink-soft mb-2">
              These holdings don&rsquo;t have a current price yet — the dashboard counts their
              invested value but not their current value.
            </p>
            <ul className="flex flex-wrap gap-2">
              {missing.map((t) => (
                <li key={`${t.asset_ticker}::${t.currency}`} className="text-xs bg-white border border-rule px-2 py-1">
                  {t.asset_ticker} ({t.currency})
                </li>
              ))}
            </ul>
          </div>
        </Section>
      )}

      <Section title="Set a price">
        <form action={upsertPrice} className="px-3 py-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Ticker">
            <input name="asset_ticker" placeholder="RELIANCE, AAPL…" required className="input" />
          </Field>
          <Field label="ISIN (optional)">
            <input name="isin" className="input" />
          </Field>
          <Field label="Currency">
            <select name="currency" required className="input">
              <option value="INR">INR</option>
              <option value="USD">USD</option>
            </select>
          </Field>
          <Field label="Current price">
            <input type="number" step="any" name="current_price" required className="input" />
          </Field>
          <div className="col-span-2 md:col-span-4">
            <button type="submit" className="bg-ink text-paper-raised text-sm px-5 py-2">
              Save price
            </button>
          </div>
        </form>
      </Section>

      <Section title={`Saved prices (${prices.length})`}>
        {prices.length === 0 ? (
          <p className="px-3 py-4 text-sm text-ink-soft">None set yet.</p>
        ) : (
          <table className="ledger">
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Currency</th>
                <th className="text-right">Price</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {prices.map((p) => (
                <tr key={p.id}>
                  <td>{p.asset_ticker}</td>
                  <td>{p.currency}</td>
                  <td className="num">{p.current_price}</td>
                  <td>{new Date(p.updated_at).toLocaleDateString("en-IN")}</td>
                  <td>
                    <form action={deletePrice}>
                      <input type="hidden" name="id" value={p.id} />
                      <button type="submit" className="text-ink-soft hover:text-loss text-xs">
                        Remove
                      </button>
                    </form>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-ink-soft">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}
