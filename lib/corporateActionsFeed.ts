// -----------------------------------------------------------------------
// Corporate-action discovery — splits and bonus issues, looked up per
// ticker so the user doesn't have to enter them by hand.
//
//   US (Yahoo Finance chart API, events=split): reliable, same endpoint
//   already used for prices — structured numerator/denominator, no text
//   parsing needed.
//
//   India (NSE corporates-corporateActions API): best-effort. NSE's own
//   API requires warming a session cookie first (same anti-bot setup
//   noted in lib/nseEquityIndex.ts) and describes actions as free text
//   ("Bonus 1:1", "Sub-Division - From Rs 10/- To Rs 5/-") that has to be
//   pattern-matched — this can miss unusual phrasings, and NSE may block
//   requests from a datacenter IP entirely. Failures return an empty
//   list rather than throwing, same as every other feed in this app —
//   manual entry is always the fallback.
// -----------------------------------------------------------------------

export interface FetchedAction {
  action_type: "split" | "bonus";
  ratio_from: number;
  ratio_to: number;
  ex_date: string; // YYYY-MM-DD
}

const YAHOO_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
};

export async function fetchYahooSplits(symbol: string): Promise<FetchedAction[]> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol
    )}?interval=1mo&range=max&events=div,splits`;
    const res = await fetch(url, { headers: YAHOO_HEADERS, cache: "no-store" });
    if (!res.ok) return [];
    const json = await res.json();
    // Yahoo's response key is "splits" (plural) even though the query
    // param is "split" (singular) — a known inconsistency in their API.
    const splits = json?.chart?.result?.[0]?.events?.splits ?? json?.chart?.result?.[0]?.events?.split;
    if (!splits || typeof splits !== "object") return [];

    const out: FetchedAction[] = [];
    for (const raw of Object.values(splits) as Array<{
      date: number;
      numerator: number;
      denominator: number;
    }>) {
      if (!raw.numerator || !raw.denominator) continue;
      out.push({
        action_type: "split",
        ratio_from: raw.denominator,
        ratio_to: raw.numerator,
        ex_date: new Date(raw.date * 1000).toISOString().slice(0, 10),
      });
    }
    return out;
  } catch {
    return [];
  }
}

const NSE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "*/*",
  Referer: "https://www.nseindia.com/",
};

function parseNseSubject(subject: string): Omit<FetchedAction, "ex_date"> | null {
  const s = subject.trim();

  const bonus = s.match(/bonus\D*?(\d+)\s*:\s*(\d+)/i);
  if (bonus) {
    const [, newShares, held] = bonus;
    return { action_type: "bonus", ratio_from: Number(held), ratio_to: Number(newShares) };
  }

  // Face-value sub-division: "...From Rs 10/- ... To Rs 2/- ..." -> 5-for-1 split
  const faceValueSplit = s.match(/from\s*rs\.?\s*([\d.]+).*?to\s*rs\.?\s*([\d.]+)/i);
  if (faceValueSplit && /split|sub-?division/i.test(s)) {
    const [, oldFv, newFv] = faceValueSplit;
    const oldFvNum = Number(oldFv);
    const newFvNum = Number(newFv);
    if (oldFvNum > 0 && newFvNum > 0 && oldFvNum !== newFvNum) {
      return { action_type: "split", ratio_from: newFvNum, ratio_to: oldFvNum };
    }
  }

  // Plain "Stock Split X:Y" — less common, but appears occasionally
  const plainSplit = s.match(/split\D*?(\d+)\s*:\s*(\d+)/i);
  if (plainSplit) {
    const [, to, from] = plainSplit;
    return { action_type: "split", ratio_from: Number(from), ratio_to: Number(to) };
  }

  return null;
}

export async function fetchNseCorporateActions(symbol: string): Promise<FetchedAction[]> {
  try {
    // Warm a session cookie against the homepage first — NSE's API
    // rejects requests without one (basic anti-bot measure).
    const warm = await fetch("https://www.nseindia.com/", { headers: NSE_HEADERS, cache: "no-store" });
    const cookie = warm.headers.get("set-cookie") ?? "";

    const url = `https://www.nseindia.com/api/corporates-corporateActions?index=equities&symbol=${encodeURIComponent(
      symbol
    )}`;
    const res = await fetch(url, {
      headers: { ...NSE_HEADERS, Cookie: cookie },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const json = await res.json();
    if (!Array.isArray(json)) return [];

    const out: FetchedAction[] = [];
    for (const row of json) {
      const subject: string = row?.subject ?? row?.purpose ?? "";
      if (!subject || !/bonus|split|sub-?division/i.test(subject)) continue;

      const parsed = parseNseSubject(subject);
      if (!parsed) continue;

      const exDateRaw: string | undefined = row?.exDate ?? row?.exdate;
      if (!exDateRaw) continue;
      // NSE dates commonly come as "DD-Mon-YYYY" e.g. "15-Jun-2026"
      const d = new Date(exDateRaw);
      if (Number.isNaN(d.getTime())) continue;

      out.push({ ...parsed, ex_date: d.toISOString().slice(0, 10) });
    }
    return out;
  } catch {
    return [];
  }
}
