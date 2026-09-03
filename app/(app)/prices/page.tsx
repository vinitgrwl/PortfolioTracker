import { createClient } from "@/lib/supabase/server";
import { upsertPrice, deletePrice, upsertExchangeRate } from "@/lib/actions";
import type { LatestPrice, Transaction, ExchangeRate } from "@/lib/types";

export default async function PricesPage() {
  const supabase = await createClient();

  const [pricesRes, txnsRes, rateRes] = await Promise.all([
    supabase.from("latest_prices").select("*").order("updated_at", { ascending: false }),
    supabase.from("transactions").select("asset_ticker, isin, currency"),
    supabase.from("exchange_rates").select("*").eq("pair", "USD_INR").maybeSingle(),
  ]);

  const prices = (pricesRes.data ?? []) as LatestPrice[];
  const transactions = (txnsRes.data ?? []) as Pick<Transaction, "asset_ticker" | "isin" | "currency">[];
  const rate = rateRes.data as ExchangeRate | null;

  const pricedKeys = new Set(prices.map((p) => `${p.asset_ticker}::${p.currency}`));
  const tickersHeld = Array.from(
    new Map(
      transactions.map((t) => [`${t.asset_ticker}::${t.currency}`, t])
    ).values()
  );
  const missing = tickersHeld.filter((t) => !pricedKeys.has(`${t.asset_ticker}::${t.currency}`));

  return (
    <div>
      <h1 className="figure-large text-2xl mb-6">Prices</h1>
      <p className="text-sm text-ink-soft mb-6 max-w-md">
        No live price feed is wired up yet — enter today&rsquo;s price for each holding here.
        This is Phase 1&rsquo;s manual placeholder; a live-price pipeline comes later.
      </p>

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
