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

drop policy if exists "members_owner_all" on members;
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
  asset_name text,                      -- company/fund display name, when known
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

-- Table may already exist without this column (added after initial
-- schema) — safe to run again if it's already there.
alter table transactions add column if not exists asset_name text;
alter table transactions add column if not exists strategy text;

alter table transactions enable row level security;

drop policy if exists "transactions_owner_all" on transactions;
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

drop policy if exists "manual_instruments_owner_all" on manual_instruments;
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

drop policy if exists "latest_prices_owner_all" on latest_prices;
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

drop policy if exists "exchange_rates_owner_all" on exchange_rates;
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

drop policy if exists "net_worth_snapshots_owner_all" on net_worth_snapshots;
create policy "net_worth_snapshots_owner_all" on net_worth_snapshots
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- corporate_actions: stock splits and bonus issues, applied by the app
-- (not stored on the transaction ledger itself, which stays a faithful
-- append-only record of what was actually bought/sold at the time).
-- Applies to the security identified by isin (or ticker+country when no
-- ISIN), across every family member who holds it — not per-member.
--
--   split: ratio_from old shares become ratio_to new shares
--          (e.g. 1-for-5 split -> ratio_from=1, ratio_to=5)
--   bonus: ratio_to bonus shares issued per ratio_from held
--          (e.g. 1:1 bonus -> ratio_from=1, ratio_to=1)
-- ---------------------------------------------------------------------
create table if not exists corporate_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  asset_ticker text not null,
  isin text,
  country text not null check (country in ('United States', 'India')),
  action_type text not null check (action_type in ('split', 'bonus')),
  ratio_from numeric not null check (ratio_from > 0),
  ratio_to numeric not null check (ratio_to > 0),
  ex_date date not null,
  source text not null default 'manual' check (source in ('manual', 'auto')),

  created_at timestamptz not null default now(),

  unique (user_id, asset_ticker, country, action_type, ex_date)
);

alter table corporate_actions enable row level security;

drop policy if exists "corporate_actions_owner_all" on corporate_actions;
create policy "corporate_actions_owner_all" on corporate_actions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists corporate_actions_ticker_idx on corporate_actions(asset_ticker);

-- ---------------------------------------------------------------------
-- cash_transactions: cash movements that are NOT a buy/sell/dividend of
-- a security — deposits, withdrawals, cross-platform transfers, interest,
-- and fees. Per-platform cash balance is DERIVED (never stored): it's the
-- sum of these rows plus the cash effect of buy/sell/dividend rows in
-- `transactions` for that platform.
--
-- A transfer is entered once by the user (from-platform, to-platform,
-- amount) and recorded as two linked rows sharing `transfer_group_id` —
-- 'transfer_send' (-amount) at the source, 'transfer_deposit' (+amount)
-- at the destination — so the user never has to enter it twice.
-- ---------------------------------------------------------------------
create table if not exists cash_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,

  txn_date date not null,
  platform text not null,
  action text not null check (
    action in ('deposit', 'withdrawal', 'transfer_send', 'transfer_deposit', 'interest', 'fees')
  ),
  amount numeric not null check (amount > 0), -- always positive; sign comes from `action`
  currency text not null check (currency in ('USD', 'INR')),

  transfer_group_id uuid, -- links the two rows of a transfer; null for everything else
  counterparty_platform text, -- the other side's platform, transfers only

  notes text,
  created_at timestamptz not null default now()
);

alter table cash_transactions enable row level security;

drop policy if exists "cash_transactions_owner_all" on cash_transactions;
create policy "cash_transactions_owner_all" on cash_transactions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists cash_transactions_member_idx on cash_transactions(member_id);
create index if not exists cash_transactions_platform_idx on cash_transactions(platform);
create index if not exists cash_transactions_transfer_group_idx on cash_transactions(transfer_group_id);

-- ---------------------------------------------------------------------
-- watchlist_items: securities the user does NOT own but wants to track
-- (price, day change). No historical storage — prices are fetched live
-- on each page view via the same feeds used for held-asset prices.
-- ---------------------------------------------------------------------
create table if not exists watchlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  asset_ticker text not null,
  asset_name text,
  country text not null check (country in ('United States', 'India')),
  asset_class text not null check (asset_class in ('Stock', 'ETF', 'Crypto')),
  currency text not null check (currency in ('USD', 'INR')),
  target_price numeric, -- optional — user's own buy-below price

  notes text,
  created_at timestamptz not null default now(),

  unique (user_id, asset_ticker, currency)
);

alter table watchlist_items enable row level security;

drop policy if exists "watchlist_items_owner_all" on watchlist_items;
create policy "watchlist_items_owner_all" on watchlist_items
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- Rebalancing targets — two levels, both percentages of a base:
--   asset_class_targets: % of TOTAL portfolio value (all 5 classes sum to 100)
--   ticker_targets:      % of that asset class's value (tickers within one
--                         class sum to 100) — Stock/ETF/Crypto/Mutual Fund
--                         only; FD/ULIP are tracked at class level only,
--                         since they're a handful of manually-entered
--                         instruments, not a ticker-identified holding.
-- Both are shared across the family-wide/per-member view toggle — the
-- app only computes each view differently, targets aren't duplicated.
-- ---------------------------------------------------------------------
create table if not exists asset_class_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  asset_class text not null check (asset_class in ('Stock', 'ETF', 'Crypto', 'Mutual Fund', 'FD', 'ULIP')),
  target_weight_pct numeric not null check (target_weight_pct >= 0 and target_weight_pct <= 100),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, asset_class)
);

alter table asset_class_targets enable row level security;

drop policy if exists "asset_class_targets_owner_all" on asset_class_targets;
create policy "asset_class_targets_owner_all" on asset_class_targets
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists ticker_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  asset_class text not null check (asset_class in ('Stock', 'ETF', 'Crypto', 'Mutual Fund')),
  asset_ticker text not null,
  isin text,
  target_weight_pct numeric not null check (target_weight_pct >= 0 and target_weight_pct <= 100),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, asset_class, asset_ticker)
);

alter table ticker_targets enable row level security;

drop policy if exists "ticker_targets_owner_all" on ticker_targets;
create policy "ticker_targets_owner_all" on ticker_targets
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists ticker_targets_class_idx on ticker_targets(asset_class);
