import ExcelJS from "exceljs";
import { cellText, cellNumber, toISODate, findHeaderRow } from "./xlsx-utils";
import type { ParsedTransaction, ParseResult } from "./types";

const REQUIRED_HEADERS = ["symbol", "isin", "trade date", "trade type", "quantity", "price"];

/**
 * Parses a Zerodha "Tradebook for Equity" export. Unlike Vested's Trades
 * sheet, the real table doesn't start at row 1 — there's a Client ID +
 * date-range metadata block first, so the header row is found dynamically.
 *
 * Known gaps (per the blueprint): no brokerage/STT/GST/stamp-duty columns
 * in this file, so fiat_fees is always 0 here — current-FY cost basis from
 * this import alone is approximate. Past-FY realized P&L should come from
 * Zerodha's separate Tax P&L report once that parser exists.
 */
export async function parseZerodhaWorkbook(buffer: ArrayBuffer): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);

  const warnings: string[] = [];
  const sheet = workbook.getWorksheet("Equity") ?? workbook.worksheets[0];

  if (!sheet) {
    return { accountHint: null, transactions: [], warnings: ["The workbook has no sheets."] };
  }

  let accountHint: string | null = null;
  for (let r = 1; r <= Math.min(10, sheet.rowCount); r++) {
    const row = sheet.getRow(r);
    let foundLabelAt = -1;
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (cellText(cell.value) === "Client ID") foundLabelAt = colNumber;
    });
    if (foundLabelAt > 0) {
      const value = cellText(row.getCell(foundLabelAt + 1).value);
      if (value) accountHint = value;
    }
  }

  const header = findHeaderRow(sheet, REQUIRED_HEADERS);
  if (!header) {
    return {
      accountHint,
      transactions: [],
      warnings: ['Could not find the trades table — is this a Zerodha "Tradebook for Equity" export?'],
    };
  }

  const col = (name: string) => header.colByHeader.get(name)!;
  const transactions: ParsedTransaction[] = [];

  for (let rowNumber = header.rowNumber + 1; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);

    const symbol = cellText(row.getCell(col("symbol")).value);
    if (!symbol) continue; // blank row — end of table or spacer

    const isin = cellText(row.getCell(col("isin")).value) || null;
    const dateValue = row.getCell(col("trade date")).value;
    const tradeType = cellText(row.getCell(col("trade type")).value).toLowerCase();
    const quantity = cellNumber(row.getCell(col("quantity")).value);
    const price = cellNumber(row.getCell(col("price")).value);

    const action = tradeType === "buy" ? "buy" : tradeType === "sell" ? "sell" : null;
    if (!action) {
      warnings.push(`Row ${rowNumber}: unrecognized trade type "${tradeType}", skipped.`);
      continue;
    }

    const txnDate = toISODate(dateValue);
    if (!txnDate) {
      warnings.push(`Row ${rowNumber}: could not read the trade date, skipped.`);
      continue;
    }

    transactions.push({
      txn_date: txnDate,
      action,
      asset_ticker: symbol.toUpperCase(),
      isin,
      quantity,
      price,
      fiat_fees: 0, // not present in the tradebook — see module docstring
      currency: "INR",
      country: "India",
      asset_class: "Stock",
      platform: "Zerodha",
    });
  }

  if (transactions.some((t) => !t.isin)) {
    warnings.push(
      "Some rows have no ISIN — those holdings will be identified by Symbol only, which can split the same company across exchanges into two positions."
    );
  }

  transactions.sort((a, b) => (a.txn_date < b.txn_date ? -1 : a.txn_date > b.txn_date ? 1 : 0));

  return { accountHint, transactions, warnings };
}
