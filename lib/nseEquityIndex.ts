// -----------------------------------------------------------------------
// NSE-listed equity index — name + symbol + ISIN, from NSE's own public
// EQUITY_L.csv archive (no auth needed, unlike NSE's live/quote APIs
// which are bot-protected). Same in-memory caching pattern as
// lib/mfSchemes.ts. Used to backfill ISIN for holdings imported without
// one (currently: AngelOne, which only gives a company name).
// -----------------------------------------------------------------------

export interface NseEquityRecord {
  symbol: string;
  isin: string;
  name: string;
}

let cache: { records: NseEquityRecord[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — listed-company list changes rarely

async function getIndex(): Promise<NseEquityRecord[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.records;

  const records: NseEquityRecord[] = [];
  try {
    const res = await fetch("https://archives.nseindia.com/content/equities/EQUITY_L.csv", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      cache: "no-store",
    });
    if (res.ok) {
      const text = await res.text();
      const lines = text.split("\n");
      // header: SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING,PAID UP VALUE,MARKET LOT,ISIN NUMBER,FACE VALUE
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",");
        if (cols.length < 7) continue;
        const symbol = cols[0]?.trim();
        const name = cols[1]?.trim();
        const isin = cols[6]?.trim();
        if (symbol && name && isin) records.push({ symbol, isin, name });
      }
    }
  } catch {
    // leave records empty — caller gets no matches, not a crash
  }

  if (records.length > 0) cache = { records, fetchedAt: Date.now() };
  return cache?.records ?? records;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(ltd|limited|the|company|co|india|inc)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export async function searchNseEquities(query: string, limit = 15): Promise<NseEquityRecord[]> {
  const q = normalize(query);
  if (q.length < 2) return [];
  const words = q.split(" ").filter(Boolean);

  const index = await getIndex();
  const matches = index.filter((r) => {
    const name = normalize(r.name);
    return words.every((w) => name.includes(w));
  });

  matches.sort((a, b) => {
    const an = normalize(a.name);
    const bn = normalize(b.name);
    const aStarts = an.startsWith(q) ? 0 : 1;
    const bStarts = bn.startsWith(q) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    return an.length - bn.length;
  });

  return matches.slice(0, limit);
}

/** Best single guess for a free-text company name (used for auto-matching). */
export async function bestNseMatch(
  freeText: string
): Promise<{ record: NseEquityRecord; confident: boolean } | null> {
  const results = await searchNseEquities(freeText, 3);
  if (results.length === 0) return null;
  const top = results[0];
  const q = normalize(freeText);
  const name = normalize(top.name);
  const confident = name === q || name.startsWith(q) || (q.length > 6 && name.includes(q));
  return { record: top, confident };
}
