export function formatINR(value: number, opts: { showSign?: boolean } = {}): string {
  const sign = opts.showSign && value > 0 ? "+" : "";
  const formatted = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Math.abs(value));
  return `${value < 0 ? "-" : sign}${formatted}`;
}

export function formatUSD(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatQty(value: number): string {
  // fractional shares (Vested) need more precision than whole-share brokers
  const decimals = Number.isInteger(value) ? 0 : 4;
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}
