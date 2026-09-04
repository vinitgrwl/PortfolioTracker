import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/server-utils";
import { addCashTransaction, addCashTransfer, deleteCashTransaction } from "@/lib/actions-cash";
import { computeCashBalances } from "@/lib/cashLedger";
import type { Member, CashTransaction, Transaction } from "@/lib/types";

const ACTION_LABELS: Record<string, string> = {
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  transfer_send: "Transfer out",
  transfer_deposit: "Transfer in",
  interest: "Interest",
  fees: "Fees",
};

export default async function CashPage() {
  const supabase = await createClient();

  const [membersRes, cashTransactions, transactions] = await Promise.all([
    supabase.from("members").select("*").order("name"),
    fetchAll<CashTransaction>(supabase, "cash_transactions"),
    fetchAll<Pick<Transaction, "platform" | "action" | "currency" | "quantity" | "price" | "fiat_fees">>(
      supabase,
      "transactions",
      "platform, action, currency, quantity, price, fiat_fees"
    ),
  ]);

  const members = (membersRes.data ?? []) as Member[];
  const balances = computeCashBalances(cashTransactions, transactions as Transaction[]);

  const negativeBalances = balances.filter((b) => b.balance < -0.01);

  const ledger = [...cashTransactions].sort((a, b) =>
    a.txn_date < b.txn_date ? 1 : a.txn_date > b.txn_date ? -1 : 0
  );

  return (
    <div>
      <h1 className="figure-large text-2xl mb-2">Cash</h1>
      <p className="text-sm text-ink-soft max-w-md mb-6">
        Per-platform cash balance, derived from deposits, withdrawals, transfers,
        interest and fees below — plus the cash effect of every buy, sell and
        dividend already logged in Transactions.
      </p>

      {negativeBalances.length > 0 && (
        <p className="text-xs text-loss mb-6">
          Negative balance on: {negativeBalances.map((b) => `${b.platform} (${b.currency})`).join(", ")}.
          This usually means a deposit or transfer was logged after the buy it funded — just a heads-up,
          nothing is blocked.
        </p>
      )}

      <Section title="Platform balances">
        {balances.length === 0 ? (
          <p className="px-3 py-4 text-sm text-ink-soft">No cash activity yet.</p>
        ) : (
          <table className="ledger">
            <thead>
              <tr>
                <th>Platform</th>
                <th>Currency</th>
                <th className="text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {balances.map((b) => (
                <tr key={`${b.platform}::${b.currency}`}>
                  <td>{b.platform}</td>
                  <td>{b.currency}</td>
                  <td className={`num ${b.balance < 0 ? "text-loss" : ""}`}>
                    {b.balance.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {members.length > 0 && (
        <>
          <Section title="Deposit / Withdrawal / Interest / Fees">
            <form action={addCashTransaction} className="px-3 py-4 grid grid-cols-2 md:grid-cols-3 gap-3">
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
                  <option value="deposit">Deposit</option>
                  <option value="withdrawal">Withdrawal</option>
                  <option value="interest">Interest</option>
                  <option value="fees">Fees</option>
                </select>
              </Field>
              <Field label="Platform">
                <input name="platform" placeholder="Vested / Zerodha / Groww…" required className="input" />
              </Field>
              <Field label="Amount">
                <input type="number" step="any" name="amount" required className="input" />
              </Field>
              <Field label="Currency">
                <select name="currency" required className="input">
                  <option value="INR">INR</option>
                  <option value="USD">USD</option>
                </select>
              </Field>
              <div className="col-span-2 md:col-span-3">
                <Field label="Notes (optional)">
                  <input name="notes" className="input" />
                </Field>
              </div>
              <div className="col-span-2 md:col-span-3">
                <button type="submit" className="bg-ink text-paper-raised text-sm px-5 py-2">
                  Add
                </button>
              </div>
            </form>
          </Section>

          <Section title="Transfer between platforms">
            <form action={addCashTransfer} className="px-3 py-4 grid grid-cols-2 md:grid-cols-3 gap-3">
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
              <Field label="Amount">
                <input type="number" step="any" name="amount" required className="input" />
              </Field>
              <Field label="From platform">
                <input name="from_platform" placeholder="Zerodha" required className="input" />
              </Field>
              <Field label="To platform">
                <input name="to_platform" placeholder="Vested" required className="input" />
              </Field>
              <Field label="Currency">
                <select name="currency" required className="input">
                  <option value="INR">INR</option>
                  <option value="USD">USD</option>
                </select>
              </Field>
              <div className="col-span-2 md:col-span-3">
                <Field label="Notes (optional)">
                  <input name="notes" className="input" />
                </Field>
              </div>
              <div className="col-span-2 md:col-span-3">
                <button type="submit" className="bg-ink text-paper-raised text-sm px-5 py-2">
                  Record transfer
                </button>
                <span className="text-xs text-ink-soft ml-3">
                  Creates one linked entry on each platform — enter it once.
                </span>
              </div>
            </form>
          </Section>
        </>
      )}

      <Section title={`Cash ledger (${ledger.length})`}>
        {ledger.length === 0 ? (
          <p className="px-3 py-4 text-sm text-ink-soft">No entries yet.</p>
        ) : (
          <table className="ledger">
            <thead>
              <tr>
                <th>Date</th>
                <th>Platform</th>
                <th>Action</th>
                <th className="text-right">Amount</th>
                <th>Currency</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((c) => (
                <tr key={c.id}>
                  <td>{new Date(c.txn_date).toLocaleDateString("en-IN")}</td>
                  <td>
                    {c.platform}
                    {c.counterparty_platform && (
                      <span className="text-ink-soft">
                        {" "}
                        {c.action === "transfer_send" ? "→" : "←"} {c.counterparty_platform}
                      </span>
                    )}
                  </td>
                  <td>{ACTION_LABELS[c.action] ?? c.action}</td>
                  <td className="num">{c.amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</td>
                  <td>{c.currency}</td>
                  <td className="text-ink-soft">{c.notes ?? ""}</td>
                  <td>
                    <form action={deleteCashTransaction}>
                      <input type="hidden" name="id" value={c.id} />
                      {c.transfer_group_id && (
                        <input type="hidden" name="transfer_group_id" value={c.transfer_group_id} />
                      )}
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
