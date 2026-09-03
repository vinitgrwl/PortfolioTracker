"use client";

import { useActionState } from "react";
import { confirmImportAction, type ImportParseState } from "@/lib/actions-import";
import type { Member } from "@/lib/types";

type ParseAction = (
  prevState: ImportParseState,
  formData: FormData
) => Promise<ImportParseState>;

export default function BrokerImportForm({
  members,
  parseAction,
  brokerLabel,
  hintLabel = "Statement identity",
}: {
  members: Member[];
  parseAction: ParseAction;
  brokerLabel: string;
  hintLabel?: string;
}) {
  const [parseState, dispatchParse, parsePending] = useActionState(parseAction, {
    status: "idle",
  });

  return (
    <div>
      <form action={dispatchParse} className="px-3 py-4 flex flex-col gap-3 max-w-md">
        <label className="block text-xs text-ink-soft">
          {brokerLabel} export (.xlsx)
          <input type="file" name="file" accept=".xlsx" required className="input mt-1" />
        </label>
        <button
          type="submit"
          disabled={parsePending}
          className="bg-ink text-paper-raised text-sm px-4 py-2 self-start disabled:opacity-60"
        >
          {parsePending ? "Reading…" : "Read file"}
        </button>
      </form>

      {parseState.status === "error" && (
        <p className="px-3 pb-4 text-sm text-loss">{parseState.message}</p>
      )}

      {parseState.status === "parsed" && (
        <PreviewAndConfirm
          members={members}
          accountHint={parseState.accountHint}
          hintLabel={hintLabel}
          transactionsJson={parseState.transactionsJson}
          count={parseState.count}
          buyCount={parseState.buyCount}
          sellCount={parseState.sellCount}
          dividendCount={parseState.dividendCount}
          warnings={parseState.warnings}
        />
      )}
    </div>
  );
}

function PreviewAndConfirm({
  members,
  accountHint,
  hintLabel,
  transactionsJson,
  count,
  buyCount,
  sellCount,
  dividendCount,
  warnings,
}: {
  members: Member[];
  accountHint: string | null;
  hintLabel: string;
  transactionsJson: string;
  count: number;
  buyCount: number;
  sellCount: number;
  dividendCount: number;
  warnings: string[];
}) {
  const [importState, dispatchImport, importPending] = useActionState(confirmImportAction, {
    status: "idle",
  });

  if (importState.status === "done") {
    return (
      <div className="px-3 pb-4">
        <div className="bg-paper-raised border border-gain text-sm px-4 py-3 max-w-md">
          Imported {importState.count} transactions. Set current prices for these tickers on the{" "}
          <a href="/prices" className="underline">
            Prices page
          </a>{" "}
          to see them reflected on the dashboard.
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 pb-4 border-t border-rule pt-4">
      <div className="text-sm mb-1">
        Found <strong>{count}</strong> transactions — {buyCount} buys, {sellCount} sells,{" "}
        {dividendCount} dividends.
      </div>
      {accountHint && (
        <div className="text-xs text-ink-soft mb-3">
          {hintLabel}: <strong>{accountHint}</strong> — confirm which family member this is
          below (statement identity isn&rsquo;t used to auto-select).
        </div>
      )}

      {warnings.length > 0 && (
        <ul className="text-xs text-loss mb-3 list-disc pl-4">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      <form action={dispatchImport} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="transactions_json" value={transactionsJson} />
        <label className="block text-xs text-ink-soft">
          Family member
          <select name="member_id" required className="input mt-1 min-w-40">
            <option value="">Choose…</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={importPending}
          className="bg-ink text-paper-raised text-sm px-4 py-2 disabled:opacity-60"
        >
          {importPending ? "Importing…" : `Import ${count} transactions`}
        </button>
      </form>

      {importState.status === "error" && (
        <p className="text-sm text-loss mt-3">{importState.message}</p>
      )}
    </div>
  );
}
