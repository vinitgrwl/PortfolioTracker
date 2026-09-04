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

// --------------------------------- Dhan ---------------------------------
// scanX customscan endpoint — unofficial/reverse-engineered, no API key.
// Unlike NSE, one call returns EVERY India-listed security's corporate
// actions for a date range (up to 5000 rows) rather than needing one
// request per ticker. Used only as a "pending review" source (see
// pending_corporate_actions in schema.sql) — the ratio direction in its
// free-text Note field ("1:1", "1:10 split") isn't confirmed from Dhan's
// documentation, so this never writes directly into corporate_actions.

export interface DhanCorpAction {
  symbol: string;
  dispName: string | null;
  actType: "BONUS" | "SPLIT";
  exDate: string; // YYYY-MM-DD
  note: string;
}

const DHAN_URL = "https://ow-scanx-analytics.dhan.co/customscan/fetchdt";
const DHAN_HEADERS = {
  "Content-Type": "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Origin: "https://scanx.dhan.co",
  Referer: "https://scanx.dhan.co/",
};

/** Fetches every BONUS/SPLIT corporate action across the whole India
 *  market for the given date range (inclusive), in one request. */
export async function fetchDhanCorporateActions(
  fromDate: string,
  toDate: string
): Promise<DhanCorpAction[]> {
  try {
    const payload = {
      data: {
        sort: "CorpAct.ExDate",
        sorder: "asc",
        count: 5000,
        fields: ["CorpAct.ActType", "Sym", "DispSym", "CorpAct.ExDate", "CorpAct.RecDate", "CorpAct.Note"],
        params: [
          { field: "Seg", op: "", val: "E" },
          { field: "OgInst", op: "", val: "ES" },
          { field: "CorpAct.ExDate", op: "gte", val: fromDate },
          { field: "CorpAct.ExDate", op: "lte", val: toDate },
          { field: "Mcapclass", op: "", val: "Largecap,Midcap,Smallcap,Microcap" },
          { field: "CorpAct.ActType", op: "", val: "BONUS,SPLIT" },
        ],
        pgno: 0,
      },
    };

    const res = await fetch(DHAN_URL, {
      method: "POST",
      headers: DHAN_HEADERS,
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const json = await res.json();
    const rows = json?.data;
    if (!Array.isArray(rows)) return [];

    const out: DhanCorpAction[] = [];
    for (const stock of rows) {
      const symbol: string | undefined = stock?.Sym;
      const dispName: string | null = stock?.DispSym ?? null;
      const actions = stock?.CorpAct;
      if (!symbol || !Array.isArray(actions)) continue;

      for (const a of actions) {
        const actType = a?.ActType;
        const exDate = a?.ExDate;
        const note = a?.Note;
        if ((actType !== "BONUS" && actType !== "SPLIT") || !exDate || !note) continue;
        if (exDate < fromDate || exDate > toDate) continue; // belt-and-braces, per Dhan's own docs
        out.push({ symbol: symbol.trim().toUpperCase(), dispName, actType, exDate, note: String(note).trim() });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Best-effort parse of Dhan's free-text Note into a ratio — a STARTING
 *  GUESS only. Direction (which number is "old"/"new") isn't confirmed
 *  from Dhan's docs, so callers must treat this as pending-review data,
 *  never write it straight into corporate_actions. Assumes the same
 *  "first:second" = "new:held" convention already used for NSE's bonus
 *  text (see parseNseSubject above) — i.e. ratio_from = second number,
 *  ratio_to = first number. Returns null if the Note doesn't contain a
 *  recognizable X:Y ratio at all (still worth showing for manual entry).
 */
export function parseDhanNote(note: string): { ratio_from: number; ratio_to: number } | null {
  const m = note.match(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const [, first, second] = m;
  const a = Number(first);
  const b = Number(second);
  if (!(a > 0) || !(b > 0)) return null;
  return { ratio_from: b, ratio_to: a };
}
