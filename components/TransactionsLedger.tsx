"use client";

import { useState } from "react";
import { updateTransaction, deleteTransaction } from "@/lib/actions";
import { formatQty } from "@/lib/format";
import type { Member, Transaction } from "@/lib/types";

export default function TransactionsLedger({
  transactions,
  members,
}: {
  transactions: Transaction[];
  members: Member[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const memberById = new Map(members.map((m) => [m.id, m.name]));

  return (
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
        {transactions.map((t) =>
          editingId === t.id ? (
            <EditRow key={t.id} txn={t} members={members} onDone={() => setEditingId(null)} />
          ) : (
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
              <td className="whitespace-nowrap">
                <button
                  type="button"
                  onClick={() => setEditingId(t.id)}
                  className="text-ink-soft hover:text-ink text-xs mr-2"
                >
                  Edit
                </button>
                <form action={deleteTransaction} className="inline">
                  <input type="hidden" name="id" value={t.id} />
                  <button type="submit" className="text-ink-soft hover:text-loss text-xs">
                    Remove
                  </button>
                </form>
              </td>
            </tr>
          )
        )}
      </tbody>
    </table>
  );
}

function EditRow({ txn, members, onDone }: { txn: Transaction; members: Member[]; onDone: () => void }) {
  return (
    <tr>
      <td colSpan={8} className="bg-paper px-3 py-3">
        <form action={updateTransaction} className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <input type="hidden" name="id" value={txn.id} />

          <EField label="Member">
            <select name="member_id" defaultValue={txn.member_id} required className="input">
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </EField>

          <EField label="Date">
            <input type="date" name="txn_date" defaultValue={txn.txn_date} required className="input" />
          </EField>

          <EField label="Action">
            <select name="action" defaultValue={txn.action} required className="input">
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
              <option value="dividend">Dividend</option>
            </select>
          </EField>

          <EField label="Platform">
            <input name="platform" defaultValue={txn.platform} required className="input" />
          </EField>

          <EField label="Ticker">
            <input name="asset_ticker" defaultValue={txn.asset_ticker} required className="input" />
          </EField>

          <EField label="ISIN">
            <input name="isin" defaultValue={txn.isin ?? ""} className="input" />
          </EField>

          <EField label="Currency">
            <select name="currency" defaultValue={txn.currency} required className="input">
              <option value="INR">INR</option>
              <option value="USD">USD</option>
            </select>
          </EField>

          <EField label="Country">
            <select name="country" defaultValue={txn.country} required className="input">
              <option value="India">India</option>
              <option value="United States">United States</option>
            </select>
          </EField>

          <EField label="Asset class">
            <select name="asset_class" defaultValue={txn.asset_class} required className="input">
              <option value="Stock">Stock</option>
              <option value="ETF">ETF</option>
              <option value="Crypto">Crypto</option>
              <option value="Mutual Fund">Mutual Fund</option>
            </select>
          </EField>

          <EField label="Quantity">
            <input type="number" step="any" name="quantity" defaultValue={txn.quantity} className="input" />
          </EField>

          <EField label="Price / unit">
            <input type="number" step="any" name="price" defaultValue={txn.price} className="input" />
          </EField>

          <EField label="Fees">
            <input type="number" step="any" name="fiat_fees" defaultValue={txn.fiat_fees} className="input" />
          </EField>

          <EField label="Dividend amount">
            <input
              type="number"
              step="any"
              name="dividend_amount"
              defaultValue={txn.action === "dividend" ? txn.price : undefined}
              className="input"
            />
          </EField>

          <EField label="Sector">
            <input name="sector" defaultValue={txn.sector ?? ""} className="input" />
          </EField>

          <EField label="Notes">
            <input name="notes" defaultValue={txn.notes ?? ""} className="input" />
          </EField>

          <div className="col-span-2 md:col-span-4 flex gap-2 mt-1">
            <button type="submit" onClick={onDone} className="bg-ink text-paper-raised text-sm px-4 py-1.5">
              Save
            </button>
            <button
              type="button"
              onClick={onDone}
              className="border border-rule text-sm px-4 py-1.5 text-ink-soft"
            >
              Cancel
            </button>
          </div>
        </form>
      </td>
    </tr>
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
