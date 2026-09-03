"use client";

import { useActionState, useState } from "react";
import { addMfTransactionByAmount, type MfAddState } from "@/lib/actions-mf";
import MfSchemePicker from "./MfSchemePicker";
import type { Member } from "@/lib/types";
import type { MfSchemeRecord } from "@/lib/mfSchemes";

const initialState: MfAddState = { status: "idle" };

export default function MfQuickAddForm({ members }: { members: Member[] }) {
  const [state, dispatch, pending] = useActionState(addMfTransactionByAmount, initialState);
  const [scheme, setScheme] = useState<MfSchemeRecord | null>(null);

  return (
    <form action={dispatch} className="px-3 py-4 grid grid-cols-2 md:grid-cols-4 gap-3">
      <div className="col-span-2">
        <label className="block text-xs text-ink-soft">
          Mutual fund
          <div className="mt-1">
            <MfSchemePicker value={scheme} onSelect={setScheme} />
          </div>
        </label>
        <input type="hidden" name="scheme_code" value={scheme?.schemeCode ?? ""} />
      </div>

      <Field label="Member">
        <select name="member_id" required className="input">
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Date">
        <input type="date" name="txn_date" required className="input" />
      </Field>

      <Field label="Action">
        <select name="action" required className="input" defaultValue="buy">
          <option value="buy">Buy</option>
          <option value="sell">Sell</option>
        </select>
      </Field>

      <Field label="Amount invested (₹)">
        <input type="number" step="any" name="amount" required className="input" />
      </Field>

      <Field label="Platform (optional)">
        <input name="platform" placeholder="Direct, Groww, Kuvera…" className="input" />
      </Field>

      <div className="col-span-2 md:col-span-4">
        <button
          type="submit"
          disabled={pending || !scheme}
          className="bg-ink text-paper-raised text-sm px-5 py-2 disabled:opacity-60"
        >
          {pending ? "Fetching NAV…" : "Add mutual fund transaction"}
        </button>
        {!scheme && <span className="text-xs text-ink-soft ml-3">Search and pick a fund first.</span>}
      </div>

      {state.status === "error" && <p className="col-span-2 md:col-span-4 text-sm text-loss">{state.message}</p>}
      {state.status === "done" && (
        <p className="col-span-2 md:col-span-4 text-sm text-gain">
          Added {state.units.toFixed(4)} units of {state.schemeName} at NAV ₹{state.nav.toFixed(4)}.
        </p>
      )}
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-ink-soft">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}
