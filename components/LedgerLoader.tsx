"use client";

import { useState, useTransition } from "react";
import { fetchTransactionsForLedger } from "@/lib/actions";
import BackfillNamesButton from "@/components/BackfillNamesButton";
import TransactionsLedger from "@/components/TransactionsLedger";
import type { Member, Transaction } from "@/lib/types";

export default function LedgerLoader({
  members,
  usdInrRate,
  approxCount,
}: {
  members: Member[];
  usdInrRate: number | null;
  approxCount: number;
}) {
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [pending, startTransition] = useTransition();

  if (transactions === null) {
    return (
      <div className="px-3 py-6 text-center">
        <p className="text-sm text-ink-soft mb-3">
          {approxCount > 0 ? `${approxCount} transaction${approxCount === 1 ? "" : "s"} logged.` : "No transactions yet."}
        </p>
        {approxCount > 0 && (
          <button
            type="button"
            disabled={pending}
            onClick={() => startTransition(async () => setTransactions(await fetchTransactionsForLedger()))}
            className="bg-ink text-paper-raised text-sm px-5 py-2 disabled:opacity-60"
          >
            {pending ? "Loading…" : "Load ledger"}
          </button>
        )}
      </div>
    );
  }

  if (transactions.length === 0) {
    return <p className="px-3 py-4 text-sm text-ink-soft">No transactions logged yet.</p>;
  }

  return (
    <>
      <BackfillNamesButton missingCount={transactions.filter((t) => !t.asset_name).length} />
      <TransactionsLedger transactions={transactions} members={members} usdInrRate={usdInrRate} />
    </>
  );
}
