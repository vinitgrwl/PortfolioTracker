"use client";

import { useEffect, useRef, useState } from "react";
import { searchMfSchemesAction } from "@/lib/actions-mf";
import type { MfSchemeRecord } from "@/lib/mfSchemes";

export default function MfSchemePicker({
  value,
  onSelect,
  placeholder = "Search fund name…",
}: {
  value: MfSchemeRecord | null;
  onSelect: (scheme: MfSchemeRecord) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState(value?.schemeName ?? "");
  const [results, setResults] = useState<MfSchemeRecord[]>([]);
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
        const found = await searchMfSchemesAction(text);
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
            <div className="px-3 py-2 text-xs text-ink-soft">No matching funds.</div>
          )}
          {results.map((r) => (
            <button
              key={r.schemeCode}
              type="button"
              onClick={() => {
                onSelect(r);
                setQuery(r.schemeName);
                setOpen(false);
              }}
              className="block w-full text-left px-3 py-2 text-xs hover:bg-paper border-b border-rule last:border-0"
            >
              {r.schemeName}
              {!r.isin && <span className="text-loss"> (no ISIN)</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
