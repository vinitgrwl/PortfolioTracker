import { createClient } from "@/lib/supabase/server";
import { addWatchlistItem, deleteWatchlistItem } from "@/lib/actions-watchlist";
import {
  fetchYahooWatchlistQuote,
  toYahooSymbol,
  fetchCryptoQuotesWithChange,
  CRYPTO_ID_MAP,
} from "@/lib/priceFeeds";
import type { WatchlistItem } from "@/lib/types";

interface RowData {
  item: WatchlistItem;
  price: number | null;
  changePercent: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  resolvedName: string | null;
}

export default async function WatchlistPage() {
  const supabase = await createClient();

  const itemsRes = await supabase.from("watchlist_items").select("*").order("asset_ticker");
  const items = (itemsRes.data ?? []) as WatchlistItem[];

  const stockItems = items.filter((i) => i.asset_class === "Stock" || i.asset_class === "ETF");
  const cryptoItems = items.filter((i) => i.asset_class === "Crypto");

  const [stockQuotes, cryptoQuotes] = await Promise.all([
    Promise.all(
      stockItems.map((i) => fetchYahooWatchlistQuote(toYahooSymbol(i.asset_ticker, i.country)))
    ),
    fetchCryptoQuotesWithChange(
      cryptoItems.map((i) => CRYPTO_ID_MAP[i.asset_ticker]).filter((id): id is string => Boolean(id))
    ),
  ]);

  const rows: RowData[] = [];

  stockItems.forEach((item, idx) => {
    const q = stockQuotes[idx];
    rows.push({
      item,
      price: q?.price ?? null,
      changePercent: q?.changePercent ?? null,
      fiftyTwoWeekHigh: q?.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow: q?.fiftyTwoWeekLow ?? null,
      resolvedName: q?.name ?? null,
    });
  });

  cryptoItems.forEach((item) => {
    const coinId = CRYPTO_ID_MAP[item.asset_ticker];
    const q = coinId ? cryptoQuotes.get(coinId) : undefined;
    const price = item.currency === "INR" ? q?.inr : q?.usd;
    const change = item.currency === "INR" ? q?.inr_24h_change : q?.usd_24h_change;
    rows.push({
      item,
      price: price ?? null,
      changePercent: change ?? null,
      fiftyTwoWeekHigh: null,
      fiftyTwoWeekLow: null,
      resolvedName: null,
    });
  });

  rows.sort((a, b) => a.item.asset_ticker.localeCompare(b.item.asset_ticker));

  return (
    <div>
      <h1 className="figure-large text-2xl mb-2">Watchlist</h1>
      <p className="text-sm text-ink-soft max-w-md mb-6">
        Securities you don&rsquo;t own yet — price and 52-week range fetched live
        (same feeds as held-asset prices) on every page load. Crypto shows 24h
        change instead of a 52-week range — the free CoinGecko tier doesn&rsquo;t
        cover it.
      </p>

      <Section title="Add to watchlist">
        <form action={addWatchlistItem} className="px-3 py-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Ticker">
            <input name="asset_ticker" placeholder="RELIANCE, AAPL, BTC…" required className="input" />
          </Field>
          <Field label="Country">
            <select name="country" required className="input">
              <option value="India">India</option>
              <option value="United States">United States</option>
            </select>
          </Field>
          <Field label="Asset class">
            <select name="asset_class" required className="input">
              <option value="Stock">Stock</option>
              <option value="ETF">ETF</option>
              <option value="Crypto">Crypto</option>
            </select>
          </Field>
          <Field label="Currency">
            <select name="currency" required className="input">
              <option value="INR">INR</option>
              <option value="USD">USD</option>
            </select>
          </Field>
          <Field label="Target price (optional)">
            <input type="number" step="any" name="target_price" className="input" />
          </Field>
          <div className="col-span-2 md:col-span-3">
            <Field label="Notes (optional)">
              <input name="notes" className="input" />
            </Field>
          </div>
          <div className="col-span-2 md:col-span-4">
            <button type="submit" className="bg-ink text-paper-raised text-sm px-5 py-2">
              Add
            </button>
          </div>
        </form>
      </Section>

      <Section title={`Tracked (${rows.length})`}>
        {rows.length === 0 ? (
          <p className="px-3 py-4 text-sm text-ink-soft">Nothing on the watchlist yet.</p>
        ) : (
          <table className="ledger">
            <thead>
              <tr>
                <th>Ticker</th>
                <th className="text-right">Price</th>
                <th className="text-right">Day %</th>
                <th className="text-right">52w Low</th>
                <th className="text-right">52w High</th>
                <th className="text-right">Target</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const hitTarget =
                  r.item.target_price !== null && r.price !== null && r.price <= r.item.target_price;
                return (
                  <tr key={r.item.id}>
                    <td>
                      {r.item.asset_ticker}
                      <div className="text-xs text-ink-soft">
                        {r.item.asset_name ?? r.resolvedName ?? ""}
                      </div>
                    </td>
                    <td className="num">{r.price !== null ? r.price.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}</td>
                    <td className={`num ${r.changePercent !== null ? (r.changePercent >= 0 ? "text-gain" : "text-loss") : ""}`}>
                      {r.changePercent !== null ? `${r.changePercent >= 0 ? "+" : ""}${r.changePercent.toFixed(2)}%` : "—"}
                    </td>
                    <td className="num">{r.fiftyTwoWeekLow !== null ? r.fiftyTwoWeekLow.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}</td>
                    <td className="num">{r.fiftyTwoWeekHigh !== null ? r.fiftyTwoWeekHigh.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}</td>
                    <td className={`num ${hitTarget ? "text-gain" : ""}`}>
                      {r.item.target_price !== null ? r.item.target_price.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}
                    </td>
                    <td>
                      <form action={deleteWatchlistItem}>
                        <input type="hidden" name="id" value={r.item.id} />
                        <button type="submit" className="text-ink-soft hover:text-loss text-xs">
                          Remove
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
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
