// -----------------------------------------------------------------------
// AMFI mutual fund scheme index — one source (NAVAll.txt) gives us
// schemeCode + both ISIN columns + schemeName + latest NAV together, so
// this is what both the fund-search picker and the bulk-import matcher
// use. Cached in-memory per warm server instance (the file is a few MB
// and doesn't change intraday) — best-effort, first request after a cold
// start just pays the fetch cost once.
// -----------------------------------------------------------------------

export interface MfSchemeRecord {
  schemeCode: string;
  schemeName: string;
  isin: string | null; // prefers the Growth-option ISIN, falls back to Reinvestment
  nav: number;
}

let cache: { records: MfSchemeRecord[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

async function getIndex(): Promise<MfSchemeRecord[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.records;

  const records: MfSchemeRecord[] = [];
  try {
    const res = await fetch("https://www.amfiindia.com/spages/NAVAll.txt", { cache: "no-store" });
    if (res.ok) {
      const text = await res.text();
      for (const line of text.split("\n")) {
        const cols = line.split(";");
        if (cols.length < 6) continue;
        const [schemeCode, isinGrowth, isinReinvest, schemeName, navStr] = cols;
        const code = schemeCode?.trim();
        const name = schemeName?.trim();
        const nav = parseFloat(navStr);
        if (!code || Number.isNaN(Number(code)) || !name || Number.isNaN(nav)) continue;
        const isin = [isinGrowth, isinReinvest].map((s) => s?.trim()).find((s) => s && s !== "-") ?? null;
        records.push({ schemeCode: code, schemeName: name, isin, nav });
      }
    }
  } catch {
    // leave records empty — caller gets no matches, not a crash
  }

  // Only replace the cache with a non-empty result, so a transient fetch
  // failure doesn't wipe out a previously-good index.
  if (records.length > 0) cache = { records, fetchedAt: Date.now() };
  return cache?.records ?? records;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Case/punctuation-insensitive, all-words-must-appear substring search. */
export async function searchMfSchemes(query: string, limit = 15): Promise<MfSchemeRecord[]> {
  const q = normalize(query);
  if (q.length < 2) return [];
  const words = q.split(" ").filter(Boolean);

  const index = await getIndex();
  const matches = index.filter((r) => {
    const name = normalize(r.schemeName);
    return words.every((w) => name.includes(w));
  });

  // Prefer names that start with the query, then shorter names (usually the more "canonical" match).
  matches.sort((a, b) => {
    const an = normalize(a.schemeName);
    const bn = normalize(b.schemeName);
    const aStarts = an.startsWith(q) ? 0 : 1;
    const bStarts = bn.startsWith(q) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    return an.length - bn.length;
  });

  return matches.slice(0, limit);
}

/** Best single guess for a free-text fund name (used by bulk-import auto-matching). */
export async function bestMfMatch(
  freeText: string
): Promise<{ record: MfSchemeRecord; confident: boolean } | null> {
  const results = await searchMfSchemes(freeText, 3);
  if (results.length === 0) return null;
  const top = results[0];
  const q = normalize(freeText);
  const name = normalize(top.schemeName);
  // "Confident" only when the whole query is essentially a prefix/substring
  // match with little left over — otherwise flag it for the user to confirm.
  const confident = name.startsWith(q) || (q.length > 8 && name.includes(q));
  return { record: top, confident };
}

export async function getSchemeByCode(schemeCode: string): Promise<MfSchemeRecord | null> {
  const index = await getIndex();
  return index.find((r) => r.schemeCode === schemeCode) ?? null;
}
