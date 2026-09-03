import ExcelJS from "exceljs";
import { cellText, cellNumber, toISODate } from "./xlsx-utils";
import type { ParsedTransaction, ParseResult } from "./types";

/**
 * Parses Vested's Excel export (sheets: "My Account", "All Transactions",
 * "Trades", "Transfers", "Income", "Glossary").
 *
 * Per the blueprint: the Trades sheet is the primary source for Buy/Sell
 * (it's clean, per-trade, and includes commission — unlike the Indian
 * brokers). The Income sheet supplies Dividend rows directly, rather than
 * parsing them out of "All Transactions"'s free-text Comment column.
 * Tax/Interest rows in Income are intentionally skipped for now — they
 * aren't part of the canonical transaction schema yet.
 */
export async function parseVestedWorkbook(buffer: ArrayBuffer): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);

  const warnings: string[] = [];
  let accountHint: string | null = null;

  const accountSheet = workbook.getWorksheet("My Account");
  if (accountSheet) {
    accountSheet.eachRow((row) => {
      const label = cellText(row.getCell(1).value);
      const value = cellText(row.getCell(2).value);
      if (label === "Name" && value) accountHint = value;
    });
  }

  const transactions: ParsedTransaction[] = [];

  const tradesSheet = workbook.getWorksheet("Trades");
  if (!tradesSheet) {
    warnings.push('No "Trades" sheet found — is this the Vested Excel export?');
  } else {
    // header (row 1): Date, Time (in UTC), Name, Ticker, Activity, Order Type,
    // Quantity, Price Per Share (in USD), Cash Amount (in USD), Commission Charges (in USD)
    tradesSheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      const dateValue = row.getCell(1).value;
      const name = cellText(row.getCell(3).value) || null;
      const ticker = cellText(row.getCell(4).value);
      const activity = cellText(row.getCell(5).value).toLowerCase();
      const quantity = cellNumber(row.getCell(7).value);
      const price = cellNumber(row.getCell(8).value);
      const fees = cellNumber(row.getCell(10).value);

      if (!ticker || !dateValue) return;

      const action = activity === "buy" ? "buy" : activity === "sell" ? "sell" : null;
      if (!action) {
        warnings.push(`Trades row ${rowNumber}: unrecognized activity "${activity}", skipped.`);
        return;
      }

      const txnDate = toISODate(dateValue);
      if (!txnDate) {
        warnings.push(`Trades row ${rowNumber}: could not read the date, skipped.`);
        return;
      }

      transactions.push({
        txn_date: txnDate,
        action,
        asset_ticker: ticker.toUpperCase(),
        asset_name: name,
        isin: null,
        quantity,
        price,
        fiat_fees: fees,
        currency: "USD",
        country: "United States",
        asset_class: "Stock",
        platform: "Vested",
      });
    });
  }

  const incomeSheet = workbook.getWorksheet("Income");
  if (!incomeSheet) {
    warnings.push('No "Income" sheet found — dividends were not imported.');
  } else {
    // header (row 1): Date, Time (in UTC), Activity, Ticker, Gross Cash Amount (in USD)
    incomeSheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      const activity = cellText(row.getCell(3).value).toLowerCase();
      if (activity !== "dividend") return; // Tax/Interest rows skipped for now

      const dateValue = row.getCell(1).value;
      const ticker = cellText(row.getCell(4).value);
      const amount = cellNumber(row.getCell(5).value);

      if (!ticker || !dateValue) return;

      const txnDate = toISODate(dateValue);
      if (!txnDate) {
        warnings.push(`Income row ${rowNumber}: could not read the date, skipped.`);
        return;
      }

      // convention (Section 3 of the blueprint): quantity = 1, price = total cash amount
      transactions.push({
        txn_date: txnDate,
        action: "dividend",
        asset_ticker: ticker.toUpperCase(),
        asset_name: null,
        isin: null,
        quantity: 1,
        price: amount,
        fiat_fees: 0,
        currency: "USD",
        country: "United States",
        asset_class: "Stock",
        platform: "Vested",
      });
    });
  }

  transactions.sort((a, b) => (a.txn_date < b.txn_date ? -1 : a.txn_date > b.txn_date ? 1 : 0));

  return { accountHint, transactions, warnings };
}
