import { createClient } from "@/lib/supabase/server";
import { addInstrument, deleteInstrument, updateInstrumentValue } from "@/lib/actions";
import { computeFDCurrentValue } from "@/lib/networth";
import { formatINR } from "@/lib/format";
import type { Member, ManualInstrument } from "@/lib/types";

export default async function InstrumentsPage() {
  const supabase = await createClient();

  const [membersRes, instrumentsRes] = await Promise.all([
    supabase.from("members").select("*").order("name"),
    supabase.from("manual_instruments").select("*").order("created_at", { ascending: false }),
  ]);

  const members = (membersRes.data ?? []) as Member[];
  const instruments = (instrumentsRes.data ?? []) as ManualInstrument[];
  const memberById = new Map(members.map((m) => [m.id, m.name]));

  return (
    <div>
      <h1 className="figure-large text-2xl mb-6">FDs &amp; ULIPs</h1>

      {members.length === 0 ? (
        <p className="text-sm text-ink-soft">
          Add a family member on the Transactions page first.
        </p>
      ) : (
        <Section title="Add an instrument">
          <form action={addInstrument} className="px-3 py-4 grid grid-cols-2 md:grid-cols-3 gap-3">
            <Field label="Member">
              <select name="member_id" required className="input">
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Type">
              <select name="asset_type" required className="input">
                <option value="FD">Fixed Deposit</option>
                <option value="ULIP">ULIP</option>
              </select>
            </Field>

            <Field label="Label">
              <input name="label" placeholder="SBI FD — 3yr" required className="input" />
            </Field>

            <Field label="Invested amount">
              <input type="number" step="any" name="invested_amount" required className="input" />
            </Field>

            <Field label="Currency">
              <select name="currency" defaultValue="INR" className="input">
                <option value="INR">INR</option>
                <option value="USD">USD</option>
              </select>
            </Field>

            <Field label="Rate % p.a. (FD only)">
              <input type="number" step="any" name="rate" placeholder="e.g. 7.1" className="input" />
            </Field>

            <Field label="Start date (FD only)">
              <input type="date" name="start_date" className="input" />
            </Field>

            <Field label="Maturity date (FD only)">
              <input type="date" name="maturity_date" className="input" />
            </Field>

            <Field label="Current value (ULIP only)">
              <input
                type="number"
                step="any"
                name="current_value"
                placeholder="Latest fund value"
                className="input"
              />
            </Field>

            <Field label="Notes (optional)">
              <input name="notes" className="input" />
            </Field>

            <div className="col-span-2 md:col-span-3">
              <button type="submit" className="bg-ink text-paper-raised text-sm px-5 py-2">
                Add instrument
              </button>
              <p className="text-xs text-ink-soft mt-2">
                FD current value is calculated automatically (compound, quarterly). ULIP current
                value is whatever you enter here — update it below whenever a new statement
                arrives.
              </p>
            </div>
          </form>
        </Section>
      )}

      <Section title={`Instruments (${instruments.length})`}>
        {instruments.length === 0 ? (
          <p className="px-3 py-4 text-sm text-ink-soft">None added yet.</p>
        ) : (
          <div className="divide-y divide-rule">
            {instruments.map((inst) => (
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
                  <form action={deleteInstrument}>
                    <input type="hidden" name="id" value={inst.id} />
                    <button type="submit" className="text-ink-soft hover:text-loss text-xs shrink-0">
                      Remove
                    </button>
                  </form>
                </div>

                {inst.asset_type === "FD" ? (
                  <div className="figure-large text-lg mt-2">
                    {inst.rate !== null && inst.start_date
                      ? formatINR(
                          computeFDCurrentValue(
                            inst.invested_amount,
                            inst.rate,
                            inst.start_date,
                            inst.maturity_date
                          )
                        )
                      : formatINR(inst.invested_amount)}
                    <span className="text-xs text-ink-soft font-sans ml-2">current value</span>
                  </div>
                ) : (
                  <form action={updateInstrumentValue} className="mt-3 flex items-end gap-2">
                    <input type="hidden" name="id" value={inst.id} />
                    <Field label="Update current value">
                      <input
                        type="number"
                        step="any"
                        name="current_value"
                        defaultValue={inst.current_value ?? undefined}
                        className="input w-40"
                      />
                    </Field>
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
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="text-sm text-ink-soft mb-2">{title}</h2>
      <div className="bg-paper-raised border border-rule">{children}</div>
    </div>
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
