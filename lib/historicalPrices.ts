// -----------------------------------------------------------------------
// Historical price series — used only by the one-time/on-demand net worth
// history backfill (lib/networthHistory.ts). Each fetcher returns a
// Map<"YYYY-MM-DD", price>. Same best-effort contract as priceFeeds.ts:
// failures return an empty map rather than throwing.
// -----------------------------------------------------------------------

const YAHOO_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
};

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ----------------------------- Yahoo Finance ----------------------------

/** Full daily close-price history for a Yahoo symbol, from listing to today. */
export async function fetchYahooHistory(symbol: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol
    )}?interval=1d&range=max`;
    const res = await fetch(url, { headers: YAHOO_HEADERS, cache: "no-store" });
    if (!res.ok) return map;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    const timestamps: number[] = result?.timestamp ?? [];
    const closes: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? [];
    timestamps.forEach((ts, i) => {
      const close = closes[i];
      if (typeof close === "number") {
        map.set(toDateKey(new Date(ts * 1000)), close);
      }
    });
  } catch {
    // empty map — caller forward-fills from whatever's available
  }
  return map;
}

export async function fetchYahooHistoryBatch(symbols: string[]): Promise<Map<string, Map<string, number>>> {
  const unique = Array.from(new Set(symbols));
  const results = await Promise.allSettled(unique.map((s) => fetchYahooHistory(s)));
  const out = new Map<string, Map<string, number>>();
  unique.forEach((symbol, i) => {
    const r = results[i];
    out.set(symbol, r.status === "fulfilled" ? r.value : new Map());
  });
  return out;
}

// ------------------------------ CoinGecko -------------------------------

/** Full daily price history for a CoinGecko coin id, in the given fiat currency. */
export async function fetchCoinGeckoHistory(
  coinId: string,
  vsCurrency: "usd" | "inr"
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(
      coinId
    )}/market_chart?vs_currency=${vsCurrency}&days=max&interval=daily`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return map;
    const json = await res.json();
    const prices: [number, number][] = json?.prices ?? [];
    for (const [ms, price] of prices) {
      map.set(toDateKey(new Date(ms)), price);
    }
  } catch {
    // empty map
  }
  return map;
}

// -------------------------------- AMFI / mfapi.in -------------------------------

/** ISIN -> AMFI scheme code, parsed from the same NAVAll.txt used for live NAV. */
export async function fetchAmfiSchemeCodeMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const res = await fetch("https://www.amfiindia.com/spages/NAVAll.txt", { cache: "no-store" });
    if (!res.ok) return map;
    const text = await res.text();
    for (const line of text.split("\n")) {
      const cols = line.split(";");
      if (cols.length < 5) continue;
      const [schemeCode, isinGrowth, isinReinvest] = cols;
      const code = schemeCode?.trim();
      if (!code || Number.isNaN(Number(code))) continue;
      for (const isin of [isinGrowth, isinReinvest]) {
        const trimmed = isin?.trim();
        if (trimmed && trimmed !== "-") map.set(trimmed, code);
      }
    }
  } catch {
    // empty map
  }
  return map;
}

/** Full daily NAV history for an AMFI scheme code, via mfapi.in (no key required). */
export async function fetchMfApiHistory(schemeCode: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const res = await fetch(`https://api.mfapi.in/mf/${encodeURIComponent(schemeCode)}`, {
      cache: "no-store",
    });
    if (!res.ok) return map;
    const json = await res.json();
    const rows: { date: string; nav: string }[] = json?.data ?? [];
    for (const row of rows) {
      // mfapi.in dates are "dd-mm-yyyy"
      const [dd, mm, yyyy] = row.date.split("-");
      const nav = parseFloat(row.nav);
      if (dd && mm && yyyy && !Number.isNaN(nav)) {
        map.set(`${yyyy}-${mm}-${dd}`, nav);
      }
    }
  } catch {
    // empty map
  }
  return map;
}

// ------------------------------ forward-fill -----------------------------

/**
 * Carries the last known value forward across gaps (weekends, market
 * holidays, days a fund didn't publish a NAV). Assumes valueAt() is
 * called with non-decreasing date keys (true for our day-by-day loop) —
 * this makes each lookup O(1) amortized instead of a fresh scan.
 */
export class ForwardFiller {
  private sortedDates: string[];
  private cursor = 0;
  private lastValue: number | undefined;

  constructor(private map: Map<string, number>) {
    this.sortedDates = Array.from(map.keys()).sort();
  }

  valueAt(dateKey: string): number | undefined {
    while (
      this.cursor < this.sortedDates.length &&
      this.sortedDates[this.cursor] <= dateKey
    ) {
      this.lastValue = this.map.get(this.sortedDates[this.cursor]);
      this.cursor += 1;
    }
    return this.lastValue;
  }
}

export function dateRangeDaily(start: Date, end: Date): string[] {
  const dates: string[] = [];
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (cur <= last) {
    dates.push(toDateKey(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}
