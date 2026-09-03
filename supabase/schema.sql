-- Family Net-Worth Tracker — schema
-- One shared family login (auth.uid()). "Member" is a plain filter column,
-- not a separate auth identity — every table is scoped to the single
-- signed-in account via RLS, and "member_id" just tags whose money it is.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- members: the people in the family whose holdings are tracked
-- ---------------------------------------------------------------------
create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

alter table members enable row level security;

create policy "members_owner_all" on members
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- transactions: Type A assets (Equity / Crypto / Mutual Funds)
-- Append-only ledger. Holdings, current value, invested value, and
-- allocation are all DERIVED from this table — never stored redundantly.
-- ---------------------------------------------------------------------
create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,

  txn_date date not null,
  platform text not null,               -- e.g. Vested, Zerodha, Groww, AngelOne, Dhan
  action text not null check (action in ('buy', 'sell', 'dividend')),

  asset_ticker text not null,           -- display symbol
  isin text,                            -- canonical identity key where available

  quantity numeric not null,            -- high precision — Vested allows fractional shares
  price numeric not null default 0,     -- per-unit price (0 for pure dividend rows)
  fiat_fees numeric not null default 0,

  currency text not null check (currency in ('USD', 'INR')),
  country text not null check (country in ('United States', 'India')),
  asset_class text not null check (asset_class in ('Stock', 'ETF', 'Crypto', 'Mutual Fund')),
  sector text,
  notes text,

  created_at timestamptz not null default now()
);

alter table transactions enable row level security;

create policy "transactions_owner_all" on transactions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists transactions_member_idx on transactions(member_id);
create index if not exists transactions_isin_idx on transactions(isin);
create index if not exists transactions_ticker_idx on transactions(asset_ticker);

-- ---------------------------------------------------------------------
-- manual_instruments: Type B assets (FD / ULIP)
-- No transaction ledger — value is either calculated (FD, compound
-- quarterly) or manually updated by the user periodically (ULIP).
-- ---------------------------------------------------------------------
create table if not exists manual_instruments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,

  asset_type text not null check (asset_type in ('FD', 'ULIP')),
  label text not null,                  -- e.g. "SBI FD — 3yr", "HDFC Life ULIP"

  invested_amount numeric not null,     -- principal (FD) or premiums paid (ULIP)
  rate numeric,                         -- FD only — annual %, quarterly compounding
  start_date date,                      -- FD only
  maturity_date date,                   -- FD only

  current_value numeric,                -- ULIP only — updated manually; FD computes at read time
  current_value_updated_at timestamptz, -- ULIP only — when current_value was last refreshed

  currency text not null default 'INR' check (currency in ('USD', 'INR')),
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table manual_instruments enable row level security;

create policy "manual_instruments_owner_all" on manual_instruments
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists manual_instruments_member_idx on manual_instruments(member_id);

-- ---------------------------------------------------------------------
-- latest_prices: manually-entered current price per ticker/ISIN
-- Placeholder until a live price-fetch pipeline is built. Keyed by
-- ISIN when available, else ticker+currency.
-- ---------------------------------------------------------------------
create table if not exists latest_prices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  asset_ticker text not null,
  isin text,
  currency text not null check (currency in ('USD', 'INR')),
  current_price numeric not null,
  updated_at timestamptz not null default now(),

  unique (user_id, asset_ticker, currency)
);

alter table latest_prices enable row level security;

create policy "latest_prices_owner_all" on latest_prices
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- exchange_rates: manually-entered current USD->INR rate, used to
-- consolidate US holdings into the base-currency (INR) net worth total.
-- Per-transaction conversion (Section 3 of the blueprint) still uses the
-- rate stored on each transaction; this table is only for "today's value".
-- ---------------------------------------------------------------------
create table if not exists exchange_rates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  pair text not null default 'USD_INR',
  rate numeric not null,
  updated_at timestamptz not null default now(),

  unique (user_id, pair)
);

alter table exchange_rates enable row level security;

create policy "exchange_rates_owner_all" on exchange_rates
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- net_worth_snapshots: one row per user per calendar day, total net
-- worth in INR. Backfilled once from transaction history + historical
-- prices, then extended forward by one row per day automatically.
-- ---------------------------------------------------------------------
create table if not exists net_worth_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  snapshot_date date not null,
  total_inr numeric not null,
  created_at timestamptz not null default now(),

  unique (user_id, snapshot_date)
);

alter table net_worth_snapshots enable row level security;

create policy "net_worth_snapshots_owner_all" on net_worth_snapshots
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
