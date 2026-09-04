"use client";

import { useMemo, useState } from "react";
import { updateTransaction, deleteTransaction } from "@/lib/actions";
import { formatQty, formatINR } from "@/lib/format";
import type { Member, Transaction } from "@/lib/types";

const ACTIONS = ["buy", "sell", "dividend"] as const;

export default function TransactionsLedger({
  transactions,
  members,
  usdInrRate,
}: {
  transactions: Transaction[];
  members: Member[];
  usdInrRate: number | null;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const memberById = new Map(members.map((m) => [m.id, m.name]));

  const platforms = useMemo(
    () => Array.from(new Set(transactions.map((t) => t.platform))).sort(),
    [transactions]
  );

  const [search, setSearch] = useState("");
  const [memberFilter, setMemberFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [platformFilter, setPlatformFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return transactions.filter((t) => {
      if (q) {
        const hay = `${t.asset_ticker} ${t.asset_name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (memberFilter && t.member_id !== memberFilter) return false;
      if (actionFilter && t.action !== actionFilter) return false;
      if (platformFilter && t.platform !== platformFilter) return false;
      if (dateFrom && t.txn_date < dateFrom) return false;
      if (dateTo && t.txn_date > dateTo) return false;
      return true;
    });
  }, [transactions, search, memberFilter, actionFilter, platformFilter, dateFrom, dateTo]);

  const hasActiveFilter =
    search || memberFilter || actionFilter || platformFilter || dateFrom || dateTo;

  return (
    <div>
      <div className="px-3 py-3 border-b border-rule bg-paper flex flex-wrap gap-2 items-end">
        <label className="text-xs text-ink-soft">
          Search
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ticker or company"
            className="input mt-1 block w-40"
          />
        </label>
        <label className="text-xs text-ink-soft">
          Member
          <select
            value={memberFilter}
            onChange={(e) => setMemberFilter(e.target.value)}
            className="input mt-1 block"
          >
            <option value="">All</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-ink-soft">
          Action
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="input mt-1 block capitalize"
          >
            <option value="">All</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a} className="capitalize">
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-ink-soft">
          Platform
          <select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value)}
            className="input mt-1 block"
          >
            <option value="">All</option>
            {platforms.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-ink-soft">
          From
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="input mt-1 block"
          />
        </label>
        <label className="text-xs text-ink-soft">
          To
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="input mt-1 block"
          />
        </label>
        {hasActiveFilter && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setMemberFilter("");
              setActionFilter("");
              setPlatformFilter("");
              setDateFrom("");
              setDateTo("");
            }}
            className="text-xs text-ink-soft hover:text-ink underline"
          >
            Clear filters
          </button>
        )}
        <span className="text-xs text-ink-soft ml-auto">
          {filtered.length} of {transactions.length}
        </span>
      </div>

      <table className="ledger">
        <thead>
          <tr>
            <th>Date</th>
            <th>Member</th>
            <th>Company</th>
            <th>Action</th>
            <th className="text-right">Qty</th>
            <th className="text-right">Price</th>
            <th className="text-right">≈ INR</th>
            <th>Platform</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((t) =>
            editingId === t.id ? (
              <EditRow key={t.id} txn={t} members={members} onDone={() => setEditingId(null)} />
            ) : (
              <tr key={t.id}>
                <td className="whitespace-nowrap">{t.txn_date}</td>
                <td>{memberById.get(t.member_id) ?? "—"}</td>
                <td>
                  <div>{t.asset_name || t.asset_ticker}</div>
                  {t.asset_name && <div className="text-xs text-ink-soft">{t.asset_ticker}</div>}
                  <div className="text-xs text-ink-soft">{t.isin ?? "no ISIN"}</div>
                </td>
                <td className="capitalize">{t.action}</td>
                <td className="num">{t.action === "dividend" ? "—" : formatQty(t.quantity)}</td>
                <td className="num">
                  {t.currency === "USD" ? "$" : "₹"}
                  {t.price}
                </td>
                <td className="num text-ink-soft">
                  {t.currency === "USD" && usdInrRate
                    ? formatINR(t.quantity * t.price * usdInrRate)
                    : "—"}
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
    </div>
  );
}

function EditRow({ txn, members, onDone }: { txn: Transaction; members: Member[]; onDone: () => void }) {
  return (
    <tr>
      <td colSpan={9} className="bg-paper px-3 py-3">
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

          <EField label="Company / fund name">
            <input name="asset_name" defaultValue={txn.asset_name ?? ""} className="input" />
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

          <EField label="Strategy">
            <input name="strategy" defaultValue={txn.strategy ?? ""} className="input" />
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
