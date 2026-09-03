# The Family Ledger — Net Worth Tracker

Build sequence per the blueprint:
1. ✅ Data model + manual entry (validates dashboard/net-worth math end-to-end)
2. ✅ Vested import, end-to-end (Excel and PDF)
3. 🔶 Broker parsers — Vested, Zerodha, Groww, AngelOne done; Dhan pending
4. ✅ FD/ULIP modules (built ahead of schedule, alongside step 1)
5. ✅ FY-wise Realized P&L report (FIFO, STCG/LTCG/VDA split)
6. ✅ Live price fetching (Yahoo/CoinGecko/AMFI, auto + manual refresh)
7. ✅ Net worth trend + allocation charts (daily historical backfill)
8. ✅ Mutual fund fund-picker + bulk import (name search, auto-NAV)
9. ✅ Company Name → ISIN resolver (merges AngelOne holdings with other brokers)
10. ✅ Transaction/instrument edit-in-place
11. ✅ Portfolio XIRR (per member, per currency)

Stack: Next.js (App Router) + Supabase (Postgres + Auth), Tailwind v4. Same
pattern as Memora's account-based build, but this is a fully separate app —
no shared code or data.

## What's built

- **Shared family login** — one email/password account for the whole family (Supabase Auth).
- **Members** — add each family member; every transaction/instrument is tagged to one.
- **Transactions ledger** — manual Buy/Sell/Dividend entry for equities/crypto/mutual
  funds. Holdings, invested value, and current value are all *derived* from this
  table at read time — nothing is double-stored.
- **Import → Vested** — upload Vested's Excel export (Trades + Income sheets),
  preview the parsed Buy/Sell/Dividend rows, pick which family member the
  statement belongs to (never auto-matched — statement names can differ from
  how the family refers to each other), then confirm to insert. Tested against
  a real Vested export (288 transactions, 0 warnings).
- **Import → Zerodha** — upload the Tradebook-for-Equity export; the parser
  finds the header row dynamically (Zerodha's file has a Client ID/date-range
  block before the real table). Uses ISIN as the holding identity, not Symbol
  (so the same company traded on both NSE and BSE doesn't split into two
  positions). No brokerage/STT/GST columns in this file, so fees import as 0
  — flagged in the UI as an approximation until the Tax P&L report parser
  exists. Tested against a real tradebook (462 transactions, 462/462 with
  ISIN, 0 warnings).
- **Import → Groww** — upload the Stocks Order History export. Price is
  derived (total Value ÷ Quantity, since Groww gives Value, not a per-unit
  price); only rows with status "Executed" are imported. No fees here either.
  Tested against a real order history (136 transactions, 136/136 with ISIN,
  0 warnings).
- **Import → AngelOne** — upload the TradesAndCharges export. This is the
  only broker with a full per-trade fee breakdown (Brokerage + GST + STT +
  Sebi Tax + Exchange Turnover + Stamp Duty + Other + IPFT, summed into
  fees), so its own log may not need a separate P&L report. Only
  Delivery + CAPITAL rows import — Intraday rows are detected and skipped
  automatically. No ISIN in this export, so holdings are identified by
  company name (won't auto-merge with the same company from another
  broker yet). Tested against a real statement (83 of 103 rows imported,
  20 correctly skipped as Intraday, ₹1,086.48 total fees captured).
- **FDs & ULIPs** — separate manual-instruments table. FD current value is
  calculated automatically (compound interest, quarterly compounding). ULIP
  current value is whatever you last entered — update it whenever a new
  statement arrives.
- **Prices** — manual current-price entry per ticker, and a USD→INR rate, since
  no live price-fetch pipeline exists yet (that's a later phase).
- **Dashboard** — consolidated net worth, broken down by member, by asset
  type, and by country.

## Not built yet (later phases, per the blueprint)

- Dhan import parser (sample not yet available)

## A note on the `xlsx` npm package

Excel parsing uses **exceljs**, not the more commonly-seen `xlsx` (SheetJS)
package — `xlsx` currently has two unpatched high-severity advisories
(prototype pollution, ReDoS) with no fix on the npm registry. `exceljs` has
one moderate advisory in a transitive dependency (`uuid`, used only for
internal IDs, not on any data path this app touches) — worth knowing about,
not worth blocking on.

## Setup

1. **Create a Supabase project** at supabase.com (free tier is fine).
2. In the Supabase SQL editor, run `supabase/schema.sql` from this repo —
   it creates all tables with row-level security already wired to the
   signed-in user.
3. Copy `.env.local.example` to `.env.local` and fill in your project's
   URL and anon key (Supabase dashboard → Project Settings → API).
4. Install and run:
   ```
   npm install
   npm run dev
   ```
5. Open the app, tap "First time — create the family account", sign up with
   one email/password for the whole family, confirm the email (Supabase's
   default flow), then sign in.
6. Add each family member on the **Transactions** page, then either log
   holdings by hand or go to **Import** to upload a Vested Excel export.
   Enter a current price for each ticker on the **Prices** page (and the
   USD→INR rate, since Vested holdings are in USD) so the dashboard can show
   current value, not just invested value.

## Deploying

Push this to GitHub and deploy on Vercel (same as Memora) — add the two env
vars in the Vercel project settings. No other config needed.

## A note on accuracy right now

Prices are 100% manual in this phase — nothing is fetched live. The
dashboard is honest about gaps: any holding without a saved price counts
toward invested value but shows "—" for current value, and a notice on the
dashboard tells you how many are missing.
