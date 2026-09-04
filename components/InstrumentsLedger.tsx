"use client";

import { useState } from "react";
import { updateInstrument, updateInstrumentValue, deleteInstrument } from "@/lib/actions";
import { computeFDCurrentValue } from "@/lib/networth";
import { formatINR } from "@/lib/format";
import type { Member, ManualInstrument } from "@/lib/types";

export default function InstrumentsLedger({
  instruments,
  members,
}: {
  instruments: ManualInstrument[];
  members: Member[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const memberById = new Map(members.map((m) => [m.id, m.name]));

  return (
    <div className="divide-y divide-rule">
      {instruments.map((inst) =>
        editingId === inst.id ? (
          <EditCard key={inst.id} inst={inst} members={members} onDone={() => setEditingId(null)} />
        ) : (
          <div key={inst.id} className="px-3 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm">
                  {inst.label}{" "}
                  <span className="text-ink-soft text-xs">
                    · {memberById.get(inst.member_id) ?? "—"} · {inst.asset_type}
                  </span>
                </div>
                <div className="text-xs text-ink-soft mt-0.5">
                  Invested {formatINR(inst.invested_amount)}
                  {inst.asset_type === "FD" && inst.rate !== null && inst.start_date && (
                    <>
                      {" "}
                      · {inst.rate}% · since {inst.start_date}
                      {inst.maturity_date ? ` · matures ${inst.maturity_date}` : ""}
                    </>
                  )}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setEditingId(inst.id)}
                  className="text-ink-soft hover:text-ink text-xs"
                >
                  Edit
                </button>
                <form action={deleteInstrument}>
                  <input type="hidden" name="id" value={inst.id} />
                  <button type="submit" className="text-ink-soft hover:text-loss text-xs">
                    Remove
                  </button>
                </form>
              </div>
            </div>

            {inst.asset_type === "FD" ? (
              <div className="figure-large text-lg mt-2">
                {inst.rate !== null && inst.start_date
                  ? formatINR(
                      computeFDCurrentValue(inst.invested_amount, inst.rate, inst.start_date, inst.maturity_date)
                    )
                  : formatINR(inst.invested_amount)}
                <span className="text-xs text-ink-soft font-sans ml-2">current value</span>
              </div>
            ) : (
              <form action={updateInstrumentValue} className="mt-3 flex items-end gap-2">
                <input type="hidden" name="id" value={inst.id} />
                <label className="block text-xs text-ink-soft">
                  Update current value
                  <div className="mt-1">
                    <input
                      type="number"
                      step="any"
                      name="current_value"
                      defaultValue={inst.current_value ?? undefined}
                      className="input w-40"
                    />
                  </div>
                </label>
                <button type="submit" className="bg-ink text-paper-raised text-sm px-3 py-1.5">
                  Save
                </button>
                {inst.current_value_updated_at && (
                  <span className="text-xs text-ink-soft mb-1.5">
                    updated {new Date(inst.current_value_updated_at).toLocaleDateString("en-IN")}
                  </span>
                )}
              </form>
            )}
          </div>
        )
      )}
    </div>
  );
}

function EditCard({
  inst,
  members,
  onDone,
}: {
  inst: ManualInstrument;
  members: Member[];
  onDone: () => void;
}) {
  return (
    <div className="px-3 py-4 bg-paper">
      <form action={updateInstrument} className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <input type="hidden" name="id" value={inst.id} />

        <EField label="Member">
          <select name="member_id" defaultValue={inst.member_id} required className="input">
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </EField>

        <EField label="Type">
          <select name="asset_type" defaultValue={inst.asset_type} required className="input">
            <option value="FD">Fixed Deposit</option>
            <option value="ULIP">ULIP</option>
          </select>
        </EField>

        <EField label="Label">
          <input name="label" defaultValue={inst.label} required className="input" />
        </EField>

        <EField label="Invested amount">
          <input type="number" step="any" name="invested_amount" defaultValue={inst.invested_amount} required className="input" />
        </EField>

        <EField label="Currency">
          <select name="currency" defaultValue={inst.currency} className="input">
            <option value="INR">INR</option>
            <option value="USD">USD</option>
          </select>
        </EField>

        <EField label="Rate % p.a. (FD only)">
          <input type="number" step="any" name="rate" defaultValue={inst.rate ?? undefined} className="input" />
        </EField>

        <EField label="Start date (FD only)">
          <input type="date" name="start_date" defaultValue={inst.start_date ?? undefined} className="input" />
        </EField>

        <EField label="Maturity date (FD only)">
          <input type="date" name="maturity_date" defaultValue={inst.maturity_date ?? undefined} className="input" />
        </EField>

        <EField label="Notes">
          <input name="notes" defaultValue={inst.notes ?? ""} className="input" />
        </EField>

        <div className="col-span-2 md:col-span-3 flex gap-2">
          <button type="submit" onClick={onDone} className="bg-ink text-paper-raised text-sm px-4 py-1.5">
            Save
          </button>
          <button type="button" onClick={onDone} className="border border-rule text-sm px-4 py-1.5 text-ink-soft">
            Cancel
          </button>
        </div>
      </form>
      <p className="text-xs text-ink-soft mt-2">
        ULIP current value isn&rsquo;t edited here — use the &ldquo;Update current value&rdquo; field on the card
        after saving.
      </p>
    </div>
  );
}

function EField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-ink-soft">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}
