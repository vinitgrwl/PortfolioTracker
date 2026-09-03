import { createClient } from "@/lib/supabase/server";
import { addMember, addTransaction, deleteTransaction, deleteMember } from "@/lib/actions";
import type { Member, Transaction } from "@/lib/types";
import { formatQty } from "@/lib/format";

export default async function TransactionsPage() {
  const supabase = await createClient();

  const [membersRes, txnsRes] = await Promise.all([
    supabase.from("members").select("*").order("name"),
    supabase.from("transactions").select("*").order("txn_date", { ascending: false }),
  ]);

  const members = (membersRes.data ?? []) as Member[];
  const transactions = (txnsRes.data ?? []) as Transaction[];
  const memberById = new Map(members.map((m) => [m.id, m.name]));

  return (
    <div>
      <h1 className="figure-large text-2xl mb-6">Transactions</h1>

      <Section title="Family members">
        <div className="px-3 py-3">
          <ul className="flex flex-wrap gap-2 mb-3">
            {members.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-2 bg-white border border-rule px-3 py-1 text-sm"
              >
                {m.name}
                <form action={deleteMember}>
                  <input type="hidden" name="id" value={m.id} />
                  <button
                    type="submit"
                    className="text-ink-soft hover:text-loss"
                    aria-label={`Remove ${m.name}`}
                  >
                    ×
                  </button>
                </form>
              </li>
            ))}
            {members.length === 0 && (
              <li className="text-sm text-ink-soft">No members yet — add the first one.</li>
            )}
          </ul>
          <form action={addMember} className="flex gap-2">
            <input
              name="name"
              placeholder="Member name"
              required
              className="border border-rule bg-white px-3 py-1.5 text-sm flex-1 max-w-xs outline-none focus:border-ink"
            />
            <button type="submit" className="bg-ink text-paper-raised text-sm px-4 py-1.5">
              Add
            </button>
          </form>
        </div>
      </Section>

      {members.length > 0 && (
        <p className="text-xs text-ink-soft mb-2">
          Have a broker statement instead of entering trades by hand?{" "}
          <a href="/import" className="underline">
            Import from a broker
          </a>
          .
        </p>
      )}

      {members.length > 0 && (
        <Section title="Log a transaction">
          <form action={addTransaction} className="px-3 py-4 grid grid-cols-2 md:grid-cols-3 gap-3">
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
              <select name="action" required className="input">
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
                <option value="dividend">Dividend</option>
              </select>
            </Field>

            <Field label="Platform">
              <input name="platform" placeholder="Vested / Zerodha / Groww…" required className="input" />
            </Field>

            <Field label="Ticker">
              <input name="asset_ticker" placeholder="RELIANCE, AAPL…" required className="input" />
            </Field>

            <Field label="ISIN (optional)">
              <input name="isin" placeholder="INE… — leave blank if unknown" className="input" />
            </Field>

            <Field label="Currency">
              <select name="currency" required className="input">
                <option value="INR">INR</option>
                <option value="USD">USD</option>
              </select>
            </Field>

            <Field label="Country">
              <select name="country" required className="input">
                <option value="India">India</option>
                <option value="United States">United States</option>
              </select>
            </Field>

            <Field label="Asset class">
              <select name="asset_class" required className="input">
                <option value="Stock">Stock</option>
                <option value="ETF">ETF</option>
                <option value="Crypto">Crypto</option>
                <option value="Mutual Fund">Mutual Fund</option>
              </select>
            </Field>

            <Field label="Quantity">
              <input
                type="number"
                step="any"
                name="quantity"
                placeholder="Not used for Dividend"
                className="input"
              />
            </Field>

            <Field label="Price / unit">
              <input
                type="number"
                step="any"
                name="price"
                placeholder="Not used for Dividend"
                className="input"
              />
            </Field>

            <Field label="Fees">
              <input type="number" step="any" name="fiat_fees" defaultValue={0} className="input" />
            </Field>

            <Field label="Dividend amount">
              <input
                type="number"
                step="any"
                name="dividend_amount"
                placeholder="Only for Dividend rows"
                className="input"
              />
            </Field>

            <Field label="Sector (optional)">
              <input name="sector" className="input" />
            </Field>

            <Field label="Notes (optional)">
              <input name="notes" className="input" />
            </Field>

            <div className="col-span-2 md:col-span-3">
              <button type="submit" className="bg-ink text-paper-raised text-sm px-5 py-2">
                Add transaction
              </button>
              <p className="text-xs text-ink-soft mt-2">
                For a Dividend row, leave Quantity and Price/unit blank and use the Dividend
                amount field instead.
              </p>
            </div>
          </form>
        </Section>
      )}

      <Section title={`Ledger (${transactions.length})`}>
        {transactions.length === 0 ? (
          <p className="px-3 py-4 text-sm text-ink-soft">No transactions logged yet.</p>
        ) : (
          <table className="ledger">
            <thead>
              <tr>
                <th>Date</th>
                <th>Member</th>
                <th>Ticker</th>
                <th>Action</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Price</th>
                <th>Platform</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id}>
                  <td className="whitespace-nowrap">{t.txn_date}</td>
                  <td>{memberById.get(t.member_id) ?? "—"}</td>
                  <td>{t.asset_ticker}</td>
                  <td className="capitalize">{t.action}</td>
                  <td className="num">{t.action === "dividend" ? "—" : formatQty(t.quantity)}</td>
                  <td className="num">
                    {t.currency === "USD" ? "$" : "₹"}
                    {t.price}
                  </td>
                  <td>{t.platform}</td>
                  <td>
                    <form action={deleteTransaction}>
                      <input type="hidden" name="id" value={t.id} />
                      <button type="submit" className="text-ink-soft hover:text-loss text-xs">
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
