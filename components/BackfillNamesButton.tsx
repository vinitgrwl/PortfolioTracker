"use client";

import { useState, useTransition } from "react";
import { backfillAssetNames } from "@/lib/actions-names";

export default function BackfillNamesButton({ missingCount }: { missingCount: number }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ updated: number; unresolved: number } | null>(null);

  if (missingCount === 0) return null;

  return (
    <div className="px-3 py-3 border-b border-rule bg-paper flex items-center justify-between gap-3 text-sm">
      {result ? (
        <p className="text-ink-soft">
          Filled in {result.updated} name{result.updated === 1 ? "" : "s"}
          {result.unresolved > 0
            ? `. ${result.unresolved} ticker${result.unresolved === 1 ? "" : "s"} couldn't be matched — showing ticker only.`
            : "."}
        </p>
      ) : (
        <p className="text-ink-soft">
          {missingCount} transaction{missingCount === 1 ? "" : "s"} missing a company/fund name.
        </p>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await backfillAssetNames();
            setResult({ updated: res.updated, unresolved: res.unresolved });
          })
        }
        className="border border-rule px-3 py-1.5 text-xs text-ink-soft hover:text-ink disabled:opacity-60 whitespace-nowrap"
      >
        {pending ? "Looking up…" : "Fill in names"}
      </button>
    </div>
  );
}
