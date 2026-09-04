import ExcelJS from "exceljs";
import { cellText, cellNumber, toISODate, findHeaderRow } from "./xlsx-utils";
import type { ParsedTransaction, ParseResult } from "./types";

const REQUIRED_HEADERS = [
  "stock name",
  "symbol",
  "isin",
  "type",
  "quantity",
  "value",
  "execution date and time",
  "order status",
];

/**
 * Parses Groww's "Stocks Order History" export. Two things this file does
 * differently from Vested/Zerodha (per the blueprint):
 *  - "Value" is the total transaction value, not a per-unit price — Price
 *    is derived as Value ÷ Quantity.
 *  - It's an order history, not a trade log, so it can contain rows that
 *    never executed — only "Executed" status rows are imported.
 * No fees/charges column here either, same gap as Zerodha.
 */
export async function parseGrowwWorkbook(buffer: ArrayBuffer): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);

  const warnings: string[] = [];
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return { accountHint: null, transactions: [], warnings: ["The workbook has no sheets."] };
  }

  let accountHint: string | null = null;
  for (let r = 1; r <= Math.min(5, sheet.rowCount); r++) {
    const row = sheet.getRow(r);
    if (cellText(row.getCell(1).value) === "Name") {
      const value = cellText(row.getCell(2).value);
      if (value) accountHint = value;
    }
  }

  const header = findHeaderRow(sheet, REQUIRED_HEADERS);
  if (!header) {
    return {
      accountHint,
      transactions: [],
      warnings: ['Could not find the order table — is this Groww\'s "Stocks Order History" export?'],
    };
  }

  const col = (name: string) => header.colByHeader.get(name)!;
  const transactions: ParsedTransaction[] = [];
  let skippedNotExecuted = 0;

  for (let rowNumber = header.rowNumber + 1; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);

    const symbol = cellText(row.getCell(col("symbol")).value);
    if (!symbol) continue; // blank row — end of table

    const status = cellText(row.getCell(col("order status")).value).toLowerCase();
    if (status !== "executed") {
      skippedNotExecuted++;
      continue;
    }

    const isin = cellText(row.getCell(col("isin")).value) || null;
    const name = cellText(row.getCell(col("stock name")).value) || null;
    const type = cellText(row.getCell(col("type")).value).toLowerCase();
    const quantity = cellNumber(row.getCell(col("quantity")).value);
    const value = cellNumber(row.getCell(col("value")).value);
    const dateValue = row.getCell(col("execution date and time")).value;

    const action = type === "buy" ? "buy" : type === "sell" ? "sell" : null;
    if (!action) {
      warnings.push(`Row ${rowNumber}: unrecognized type "${type}", skipped.`);
      continue;
    }

    const txnDate = toISODate(dateValue);
    if (!txnDate) {
      warnings.push(`Row ${rowNumber}: could not read the date, skipped.`);
      continue;
    }

    const price = quantity > 0 ? value / quantity : 0;

    transactions.push({
      txn_date: txnDate,
      action,
      asset_ticker: symbol.toUpperCase(),
      asset_name: name,
      isin,
      quantity,
      price,
      fiat_fees: 0, // not present in this export — see module docstring
      currency: "INR",
      country: "India",
      asset_class: "Stock",
      platform: "Groww",
    });
  }

  if (skippedNotExecuted > 0) {
    warnings.push(
      `${skippedNotExecuted} row(s) skipped — not "Executed" (pending or cancelled orders).`
    );
  }
  if (transactions.some((t) => !t.isin)) {
    warnings.push(
      "Some rows have no ISIN — those holdings will be identified by Symbol only, which can split the same company across exchanges into two positions."
    );
  }

  transactions.sort((a, b) => (a.txn_date < b.txn_date ? -1 : a.txn_date > b.txn_date ? 1 : 0));

  return { accountHint, transactions, warnings };
}
