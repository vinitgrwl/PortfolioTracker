"use client";

import { useState, useTransition, useMemo } from "react";
import { listAllSecurities, mergeSecuritiesAction, type DistinctSecurity } from "@/lib/actions-merge-securities";

export default function MergeSecuritiesTool() {
  const [securities, setSecurities] = useState<DistinctSecurity[] | null>(null);
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const keyOf = (s: DistinctSecurity) => `${s.ticker}::${s.isin ?? ""}::${s.country}`;

  const filtered = useMemo(() => {
    if (!securities) return [];
    const q = search.trim().toLowerCase();
    if (!q) return securities;
    return securities.filter((s) => s.ticker.toLowerCase().includes(q));
  }, [securities, search]);

  const selectedSecurities = securities?.filter((s) => selected.has(keyOf(s))) ?? [];

  if (securities === null) {
    return (
      <div className="px-3 py-4">
        <p className="text-xs text-ink-soft mb-2">
          If the ISIN-conflict check above found nothing but a stock still shows up more than once, the
          ticker itself was probably logged differently across imports (a typo, a broker-specific spelling).
          This lists every distinct ticker/ISIN combination actually in your ledger — pick the ones that are
          really the same stock and merge them.
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(async () => setSecurities(await listAllSecurities()))}
          className="border border-rule px-3 py-1.5 text-xs text-ink-soft hover:text-ink disabled:opacity-60"
        >
          {pending ? "Loading…" : "List all securities"}
        </button>
      </div>
    );
  }

  return (
    <div className="px-3 py-3">
      {done && <p className="text-xs text-gain mb-2">{done}</p>}
      {error && <p className="text-xs text-loss mb-2">{error}</p>}

      <input
        type="text"
        placeholder="Search ticker…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="input mb-2 max-w-xs"
      />

      <div className="max-h-64 overflow-y-auto border border-rule mb-3">
        <table className="ledger">
          <thead>
            <tr>
              <th></th>
              <th>Ticker</th>
              <th>ISIN</th>
              <th>Country</th>
              <th className="text-right">Rows</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => {
              const key = keyOf(s);
              return (
                <tr key={key}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(key)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(key);
                        else next.delete(key);
                        setSelected(next);
                      }}
                    />
                  </td>
                  <td>{s.ticker}</td>
                  <td className="text-xs text-ink-soft">{s.isin ?? "no ISIN"}</td>
                  <td>{s.country}</td>
                  <td className="num">{s.rowCount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selectedSecurities.length >= 2 && (
        <form
          action={async (fd) => {
            setError(null);
            setDone(null);
            fd.set(
              "sources_json",
              JSON.stringify(selectedSecurities.map((s) => ({ ticker: s.ticker, isin: s.isin, country: s.country })))
            );
            try {
              await mergeSecuritiesAction(fd);
              setDone(`Merged ${selectedSecurities.length} entries into ${fd.get("target_ticker")}.`);
              setSelected(new Set());
              setSecurities(await listAllSecurities());
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not merge — try again.");
            }
          }}
          className="flex flex-wrap gap-2 items-end p-3 border border-rule bg-paper"
        >
          <p className="w-full text-xs text-ink-soft">
            Merging {selectedSecurities.length} selected rows into one identity — pick which ticker/ISIN/country
            is correct (defaults to the first selected row).
          </p>
          <label className="text-xs text-ink-soft">
            Target ticker
            <input
              name="target_ticker"
              required
              defaultValue={selectedSecurities[0].ticker}
              className="input mt-1 w-28"
            />
          </label>
          <label className="text-xs text-ink-soft">
            Target ISIN (optional)
            <input name="target_isin" defaultValue={selectedSecurities[0].isin ?? ""} className="input mt-1 w-40" />
          </label>
          <label className="text-xs text-ink-soft">
            Target country
            <select name="target_country" defaultValue={selectedSecurities[0].country} required className="input mt-1">
              <option value="India">India</option>
              <option value="United States">United States</option>
            </select>
          </label>
          <button type="submit" className="bg-ink text-paper-raised text-sm px-4 py-1.5">
            Merge
          </button>
        </form>
      )}
    </div>
  );
}
