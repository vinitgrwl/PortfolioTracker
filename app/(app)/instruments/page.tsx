import { createClient } from "@/lib/supabase/server";
import { addInstrument } from "@/lib/actions";
import InstrumentsLedger from "@/components/InstrumentsLedger";
import type { Member, ManualInstrument } from "@/lib/types";

export default async function InstrumentsPage() {
  const supabase = await createClient();

  const [membersRes, instrumentsRes] = await Promise.all([
    supabase.from("members").select("*").order("name"),
    supabase.from("manual_instruments").select("*").order("created_at", { ascending: false }),
  ]);

  const members = (membersRes.data ?? []) as Member[];
  const instruments = (instrumentsRes.data ?? []) as ManualInstrument[];
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
          <InstrumentsLedger instruments={instruments} members={members} />
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
