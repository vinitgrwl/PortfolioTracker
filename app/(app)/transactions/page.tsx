import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/server-utils";
import { addMember, addTransaction, deleteMember } from "@/lib/actions";
import MfQuickAddForm from "@/components/MfQuickAddForm";
import TransactionsLedger from "@/components/TransactionsLedger";
import IsinResolver from "@/components/IsinResolver";
import BackfillNamesButton from "@/components/BackfillNamesButton";
import CorporateActionsManager from "@/components/CorporateActionsManager";
import { findUnresolvedTickers } from "@/lib/actions-isin";
import type { Member, Transaction, CorporateAction } from "@/lib/types";

export default async function TransactionsPage() {
  const supabase = await createClient();

  const [membersRes, transactions, corporateActions] = await Promise.all([
    supabase.from("members").select("*").order("name"),
    fetchAll<Transaction>(supabase, "transactions"),
    fetchAll<CorporateAction>(supabase, "corporate_actions"),
  ]);

  const members = (membersRes.data ?? []) as Member[];
  transactions.sort((a, b) => (a.txn_date < b.txn_date ? 1 : a.txn_date > b.txn_date ? -1 : 0));
  const unresolvedTickers = await findUnresolvedTickers();

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

            <Field label="Strategy (optional)">
              <input name="strategy" placeholder="Core, Swing, Long Term…" className="input" />
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
                amount field instead. For Mutual Funds, use the dedicated form below instead —
                it looks up the fund and NAV for you.
              </p>
            </div>
          </form>
        </Section>
      )}

      {members.length > 0 && (
        <Section title="Log a mutual fund">
          <p className="px-3 pt-3 text-xs text-ink-soft">
            Search the fund, pick a date and enter how much you invested — the NAV for that date
            is fetched automatically and units are calculated for you.
          </p>
          <MfQuickAddForm members={members} />
          <p className="px-3 pb-3 text-xs text-ink-soft">
            Have a list of many SIP/lumpsum entries? Use{" "}
            <a href="/import" className="underline">
              the bulk import
            </a>{" "}
            on the Import page instead.
          </p>
        </Section>
      )}

      {unresolvedTickers.length > 0 && (
        <Section title={`Fix missing ISINs (${unresolvedTickers.length})`}>
          <IsinResolver tickers={unresolvedTickers} />
        </Section>
      )}

      <Section title={`Corporate actions (${corporateActions.length})`}>
        <CorporateActionsManager actions={corporateActions} />
      </Section>

      <Section title={`Ledger (${transactions.length})`}>
        {transactions.length === 0 ? (
          <p className="px-3 py-4 text-sm text-ink-soft">No transactions logged yet.</p>
        ) : (
          <>
            <BackfillNamesButton missingCount={transactions.filter((t) => !t.asset_name).length} />
            <TransactionsLedger transactions={transactions} members={members} />
          </>
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
