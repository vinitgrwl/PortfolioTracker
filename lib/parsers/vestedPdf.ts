import { PDFParse } from "pdf-parse";
import type { ParsedTransaction, ParseResult } from "./types";

/**
 * Parses Vested's PDF "Account Statement" export (the fallback for people
 * who only have the PDF, not the Excel export parsed by vested.ts).
 *
 * Approach: extract raw text (pdf-parse gives one row per line for this
 * statement's simple table layout) and pull rows out with two regexes —
 * validated against a real sample statement (264/264 Trades rows and
 * 24/24 Dividend rows matched against the statement's own "All
 * Transactions" summary sheet, which lists the same activity a second way).
 *
 * Trades rows look like:
 *   "2026-09-02 06:51:59 PM Datadog Inc DDOG Buy Market 0.11942225 208.84 25 0.06"
 *   (date, time, company name, TICKER, Buy|Sell, "Market", quantity, price, cash amount, [commission])
 * Commission is sometimes blank (very small trades) — 3 trailing numbers
 * instead of 4 — handled below.
 *
 * Income rows (dividends only — tax/interest skipped, same as the Excel
 * parser) look like:
 *   "2026-09-01 01:54:14 PM Dividend V 0.31"
 */

const TRADE_LINE = /^(\d{4}-\d{2}-\d{2}) \d{1,2}:\d{2}:\d{2} [AP]M .+ (\S+) (Buy|Sell) Market (.+)$/;
const DIVIDEND_LINE = /^(\d{4}-\d{2}-\d{2}) \d{1,2}:\d{2}:\d{2} [AP]M Dividend (\S+) (-?[\d.]+)$/;

export async function parseVestedPdf(buffer: ArrayBuffer): Promise<ParseResult> {
  const warnings: string[] = [];
  let text: string;

  try {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    text = result.text;
  } catch (e) {
    return {
      accountHint: null,
      transactions: [],
      warnings: [e instanceof Error ? `Could not read the PDF: ${e.message}` : "Could not read the PDF."],
    };
  }

  const nameMatch = text.match(/^Name:\s*(.+)$/m);
  const accountHint = nameMatch ? nameMatch[1].trim() : null;

  const transactions: ParsedTransaction[] = [];
  const lines = text.split("\n");

  for (const line of lines) {
    const tradeMatch = line.match(TRADE_LINE);
    if (tradeMatch) {
      const [, txnDate, ticker, activity, rest] = tradeMatch;
      const nums = rest.trim().split(/\s+/).map(Number);
      if (nums.length < 3 || nums.some((n) => Number.isNaN(n))) {
        warnings.push(`Trades row on ${txnDate} (${ticker}): couldn't parse the numbers, skipped.`);
        continue;
      }
      const [quantity, price] = nums;
      const fees = nums.length >= 4 ? nums[3] : 0;

      transactions.push({
        txn_date: txnDate,
        action: activity === "Buy" ? "buy" : "sell",
        asset_ticker: ticker.toUpperCase(),
        isin: null,
        quantity,
        price,
        fiat_fees: fees,
        currency: "USD",
        country: "United States",
        asset_class: "Stock",
        platform: "Vested",
      });
      continue;
    }

    const divMatch = line.match(DIVIDEND_LINE);
    if (divMatch) {
      const [, txnDate, ticker, amountStr] = divMatch;
      const amount = Number(amountStr);
      if (Number.isNaN(amount)) continue;
      transactions.push({
        txn_date: txnDate,
        action: "dividend",
        asset_ticker: ticker.toUpperCase(),
        isin: null,
        quantity: 1,
        price: amount,
        fiat_fees: 0,
        currency: "USD",
        country: "United States",
        asset_class: "Stock",
        platform: "Vested",
      });
    }
  }

  if (transactions.length === 0) {
    warnings.push(
      'No Buy/Sell/Dividend rows found — is this Vested\'s "Account Statement" PDF export, unedited?'
    );
  }

  transactions.sort((a, b) => (a.txn_date < b.txn_date ? -1 : a.txn_date > b.txn_date ? 1 : 0));

  return { accountHint, transactions, warnings };
}
