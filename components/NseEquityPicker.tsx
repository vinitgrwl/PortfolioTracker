"use client";

import { useEffect, useRef, useState } from "react";
import { searchNseEquitiesAction } from "@/lib/actions-isin";
import type { NseEquityRecord } from "@/lib/nseEquityIndex";

export default function NseEquityPicker({
  value,
  onSelect,
  placeholder = "Search company name…",
}: {
  value: NseEquityRecord | null;
  onSelect: (equity: NseEquityRecord) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState(value?.name ?? "");
  const [results, setResults] = useState<NseEquityRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function handleChange(text: string) {
    setQuery(text);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const found = await searchNseEquitiesAction(text);
        setResults(found);
      } finally {
        setLoading(false);
      }
    }, 300);
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="input"
        autoComplete="off"
      />
      {open && (query.trim().length >= 2 || results.length > 0) && (
        <div className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto bg-paper-raised border border-rule shadow-sm">
          {loading && <div className="px-3 py-2 text-xs text-ink-soft">Searching…</div>}
          {!loading && results.length === 0 && query.trim().length >= 2 && (
            <div className="px-3 py-2 text-xs text-ink-soft">No matching companies.</div>
          )}
          {results.map((r) => (
            <button
              key={r.isin}
              type="button"
              onClick={() => {
                onSelect(r);
                setQuery(r.name);
                setOpen(false);
              }}
              className="block w-full text-left px-3 py-2 text-xs hover:bg-paper border-b border-rule last:border-0"
            >
              {r.name} <span className="text-ink-soft">({r.symbol})</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
