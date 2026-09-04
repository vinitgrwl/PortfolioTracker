// -----------------------------------------------------------------------
// Live price feeds — all free, no API key required.
//   Stocks (India + US) & USD/INR : Yahoo Finance chart API
//   Crypto                        : CoinGecko public API
//   Mutual Funds                  : AMFI daily NAVAll.txt (matched by ISIN)
//
// Every function here is best-effort: a failed/blocked call returns
// null (or an empty map) instead of throwing, so one bad symbol never
// takes down the whole refresh.
// -----------------------------------------------------------------------

const YAHOO_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
};

// ----------------------------- Yahoo Finance ----------------------------

export async function fetchYahooPrice(symbol: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol
    )}?interval=1d&range=1d`;
    const res = await fetch(url, { headers: YAHOO_HEADERS, cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof price === "number" ? price : null;
  } catch {
    return null;
  }
}

/** Company/instrument display name for a US-listed symbol, from the same
 *  Yahoo chart endpoint used for price — no separate API call needed. */
export async function fetchYahooName(symbol: string): Promise<string | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol
    )}?interval=1d&range=1d`;
    const res = await fetch(url, { headers: YAHOO_HEADERS, cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    const name = meta?.longName ?? meta?.shortName;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

/** Fetches many Yahoo symbols in parallel. Returns symbol -> price (skips failures). */
export async function fetchYahooBatch(
  symbols: string[]
): Promise<Map<string, number>> {
  const unique = Array.from(new Set(symbols));
  const results = await Promise.allSettled(unique.map((s) => fetchYahooPrice(s)));
  const map = new Map<string, number>();
  unique.forEach((symbol, i) => {
    const r = results[i];
    if (r.status === "fulfilled" && r.value !== null) map.set(symbol, r.value);
  });
  return map;
}

export function toYahooSymbol(ticker: string, country: "India" | "United States"): string {
  const t = ticker.trim().toUpperCase();
  return country === "India" ? `${t}.NS` : t;
}

export interface WatchlistQuote {
  price: number;
  changePercent: number | null; // vs previous close
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  name: string | null;
}

/** Fuller quote for the Watchlist page — price, day change %, and 52-week
 *  range. Uses a 1-year daily range so the high/low is computed from the
 *  actual close series rather than relying on Yahoo's meta fields, which
 *  aren't consistently present. */
export async function fetchYahooWatchlistQuote(symbol: string): Promise<WatchlistQuote | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol
    )}?interval=1d&range=1y`;
    const res = await fetch(url, { headers: YAHOO_HEADERS, cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    const meta = result?.meta;
    const price = meta?.regularMarketPrice;
    if (typeof price !== "number") return null;

    const closes: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? [];
    const validCloses = closes.filter((c): c is number => typeof c === "number");
    const fiftyTwoWeekHigh =
      typeof meta?.fiftyTwoWeekHigh === "number"
        ? meta.fiftyTwoWeekHigh
        : validCloses.length > 0
        ? Math.max(...validCloses)
        : null;
    const fiftyTwoWeekLow =
      typeof meta?.fiftyTwoWeekLow === "number"
        ? meta.fiftyTwoWeekLow
        : validCloses.length > 0
        ? Math.min(...validCloses)
        : null;

    const prevClose = meta?.chartPreviousClose ?? meta?.previousClose;
    const changePercent =
      typeof prevClose === "number" && prevClose !== 0 ? ((price - prevClose) / prevClose) * 100 : null;

    const name = meta?.longName ?? meta?.shortName ?? null;

    return { price, changePercent, fiftyTwoWeekHigh, fiftyTwoWeekLow, name };
  } catch {
    return null;
  }
}

// ------------------------------ CoinGecko -------------------------------

// Common ticker -> CoinGecko coin id. Anything not listed here falls back
// to manual entry (shown in the Prices page's "Missing prices" section).
export const CRYPTO_ID_MAP: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
  XRP: "ripple",
  ADA: "cardano",
  DOGE: "dogecoin",
  DOT: "polkadot",
  MATIC: "matic-network",
  POL: "polygon-ecosystem-token",
  LTC: "litecoin",
  AVAX: "avalanche-2",
  LINK: "chainlink",
  TRX: "tron",
  SHIB: "shiba-inu",
  USDT: "tether",
  USDC: "usd-coin",
  ATOM: "cosmos",
  UNI: "uniswap",
  XLM: "stellar",
  ETC: "ethereum-classic",
  FIL: "filecoin",
  APT: "aptos",
  ARB: "arbitrum",
  OP: "optimism",
  NEAR: "near",
  ICP: "internet-computer",
  BCH: "bitcoin-cash",
  XMR: "monero",
  TON: "the-open-network",
  INJ: "injective-protocol",
  SUI: "sui",
  PEPE: "pepe",
};

/** Fetches CoinGecko prices for the given coin ids in both usd and inr. */
export async function fetchCryptoPrices(
  coinIds: string[]
): Promise<Map<string, { usd?: number; inr?: number }>> {
  const unique = Array.from(new Set(coinIds));
  const map = new Map<string, { usd?: number; inr?: number }>();
  if (unique.length === 0) return map;

  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${unique
      .map(encodeURIComponent)
      .join(",")}&vs_currencies=usd,inr`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return map;
    const json = await res.json();
    for (const id of unique) {
      if (json[id]) map.set(id, { usd: json[id].usd, inr: json[id].inr });
    }
  } catch {
    // return whatever we have (empty map) — caller treats missing as unresolved
  }
  return map;
}

/** Crypto quote with 24h change — used by the Watchlist page. CoinGecko's
 *  free tier has no 52-week high/low endpoint, so watchlist crypto rows
 *  show price + 24h change only (noted in the UI). */
export async function fetchCryptoQuotesWithChange(
  coinIds: string[]
): Promise<Map<string, { usd?: number; inr?: number; usd_24h_change?: number; inr_24h_change?: number }>> {
  const unique = Array.from(new Set(coinIds));
  const map = new Map<
    string,
    { usd?: number; inr?: number; usd_24h_change?: number; inr_24h_change?: number }
  >();
  if (unique.length === 0) return map;

  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${unique
      .map(encodeURIComponent)
      .join(",")}&vs_currencies=usd,inr&include_24hr_change=true`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return map;
    const json = await res.json();
    for (const id of unique) {
      if (json[id]) map.set(id, json[id]);
    }
  } catch {
    // return whatever we have — caller treats missing as unresolved
  }
  return map;
}

// -------------------------------- AMFI NAV -------------------------------

/**
 * Downloads AMFI's daily NAVAll.txt and returns a map of
 * ISIN -> current NAV (per unit, in INR). Covers both the
 * "Div Payout/Growth" and "Div Reinvestment" ISIN columns since a
 * scheme can be held under either.
 */
export async function fetchAmfiNavMap(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const res = await fetch("https://www.amfiindia.com/spages/NAVAll.txt", {
      cache: "no-store",
    });
    if (!res.ok) return map;
    const text = await res.text();

    for (const line of text.split("\n")) {
      const cols = line.split(";");
      if (cols.length < 5) continue; // header / scheme-category lines
      const [, isinGrowth, isinReinvest, , navStr] = cols;
      const nav = parseFloat(navStr);
      if (Number.isNaN(nav)) continue;
      for (const isin of [isinGrowth, isinReinvest]) {
        const trimmed = isin?.trim();
        if (trimmed && trimmed !== "-") map.set(trimmed, nav);
      }
    }
  } catch {
    // return whatever we parsed (possibly empty) — caller treats missing as unresolved
  }
  return map;
}
