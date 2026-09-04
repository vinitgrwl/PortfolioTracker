"use client";

import { useActionState, useState } from "react";
import {
  parseMfBulkAction,
  confirmMfBulkAction,
  type MfBulkParseState,
  type MfBulkConfirmState,
  type MfBulkPreviewRow,
} from "@/lib/actions-mf";
import MfSchemePicker from "./MfSchemePicker";
import { formatINR } from "@/lib/format";
import type { Member } from "@/lib/types";
import type { MfSchemeRecord } from "@/lib/mfSchemes";

const initialParseState: MfBulkParseState = { status: "idle" };

export default function MfBulkImportForm({ members }: { members: Member[] }) {
  const [parseState, dispatchParse, parsePending] = useActionState(parseMfBulkAction, initialParseState);

  return (
    <div>
      <form action={dispatchParse} className="px-3 py-4 flex flex-col gap-3 max-w-md">
        <label className="block text-xs text-ink-soft">
          Fund/Date/Amount sheet (.xlsx)
          <input type="file" name="file" accept=".xlsx" required className="input mt-1" />
        </label>
        <p className="text-xs text-ink-soft">
          Columns needed (any order): <strong>Fund Name</strong>, <strong>Date</strong>,{" "}
          <strong>Amount</strong>.
        </p>
        <button
          type="submit"
          disabled={parsePending}
          className="bg-ink text-paper-raised text-sm px-4 py-2 self-start disabled:opacity-60"
        >
          {parsePending ? "Reading…" : "Read file"}
        </button>
      </form>

      {parseState.status === "error" && <p className="px-3 pb-4 text-sm text-loss">{parseState.message}</p>}

      {parseState.status === "parsed" && (
        <MfBulkPreview
          members={members}
          rowsJson={parseState.rowsJson}
          count={parseState.count}
          unmatchedCount={parseState.unmatchedCount}
          warnings={parseState.warnings}
        />
      )}
    </div>
  );
}

const initialConfirmState: MfBulkConfirmState = { status: "idle" };

function MfBulkPreview({
  members,
  rowsJson,
  count,
  unmatchedCount,
  warnings,
}: {
  members: Member[];
  rowsJson: string;
  count: number;
  unmatchedCount: number;
  warnings: string[];
}) {
  const [rows, setRows] = useState<MfBulkPreviewRow[]>(() => JSON.parse(rowsJson));
  const [confirmState, dispatchConfirm, confirmPending] = useActionState(
    confirmMfBulkAction,
    initialConfirmState
  );

  function updateRow(index: number, scheme: MfSchemeRecord) {
    setRows((prev) =>
      prev.map((r, i) =>
        i === index
          ? { ...r, schemeCode: scheme.schemeCode, schemeName: scheme.schemeName, isin: scheme.isin, confident: true }
          : r
      )
    );
  }

  if (confirmState.status === "done") {
    return (
      <div className="px-3 pb-4">
        <div className="bg-paper-raised border border-gain text-sm px-4 py-3 max-w-md">
          Imported {confirmState.count} transactions
          {confirmState.skipped > 0 ? ` (${confirmState.skipped} skipped — no fund matched or no NAV found)` : ""}
          {confirmState.duplicateCount > 0
            ? ` — ${confirmState.duplicateCount} duplicate${confirmState.duplicateCount === 1 ? "" : "s"} already in the ledger for this member were skipped`
            : ""}
          .
        </div>
      </div>
    );
  }

  const stillUnmatched = rows.filter((r) => !r.schemeCode).length;

  return (
    <div className="px-3 pb-4 border-t border-rule pt-4">
      <div className="text-sm mb-1">
        Found <strong>{count}</strong> rows — {unmatchedCount} need a fund confirmed below.
      </div>
      {warnings.length > 0 && (
        <ul className="text-xs text-loss mb-3 list-disc pl-4">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      <div className="max-h-96 overflow-y-auto border border-rule mb-4">
        <table className="ledger">
          <thead>
            <tr>
              <th>Date</th>
              <th className="text-right">Amount</th>
              <th>From file</th>
              <th>Matched fund</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.rowNumber} className={!r.schemeCode ? "bg-loss/5" : !r.confident ? "bg-brass-soft/10" : ""}>
                <td className="whitespace-nowrap">{r.txn_date}</td>
                <td className="num">{formatINR(r.amount)}</td>
                <td className="text-xs text-ink-soft max-w-40 truncate" title={r.fundNameRaw}>
                  {r.fundNameRaw}
                </td>
                <td className="min-w-64">
                  <MfSchemePicker
                    value={r.schemeCode ? { schemeCode: r.schemeCode, schemeName: r.schemeName!, isin: r.isin, nav: 0 } : null}
                    onSelect={(scheme) => updateRow(i, scheme)}
                    placeholder="Confirm fund…"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form action={dispatchConfirm} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="rows_json" value={JSON.stringify(rows)} />
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
        <label className="block text-xs text-ink-soft">
          Platform (optional)
          <input name="platform" placeholder="Direct, Groww, Kuvera…" className="input mt-1" />
        </label>
        <button
          type="submit"
          disabled={confirmPending || stillUnmatched === rows.length}
          className="bg-ink text-paper-raised text-sm px-4 py-2 disabled:opacity-60"
        >
          {confirmPending ? "Importing…" : `Import ${rows.length - stillUnmatched} of ${rows.length}`}
        </button>
      </form>
      {stillUnmatched > 0 && (
        <p className="text-xs text-ink-soft mt-2">
          {stillUnmatched} row{stillUnmatched > 1 ? "s" : ""} still without a fund match — they&rsquo;ll be
          skipped unless confirmed above.
        </p>
      )}

      {confirmState.status === "error" && <p className="text-sm text-loss mt-3">{confirmState.message}</p>}
    </div>
  );
}
