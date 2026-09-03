import ExcelJS from "exceljs";
import { cellText, cellNumber, toISODate, findHeaderRow } from "./xlsx-utils";

const REQUIRED_HEADERS = ["fund name", "date", "amount"];

export interface MfBulkRow {
  rowNumber: number;
  fundNameRaw: string;
  txn_date: string; // YYYY-MM-DD
  amount: number;
}

export interface MfBulkParseResult {
  rows: MfBulkRow[];
  warnings: string[];
}

/**
 * Parses a simple "Fund Name / Date / Amount" sheet — the user's own
 * record of SIP/lumpsum purchases (e.g. exported from a CAMS/KFintech
 * consolidated statement or their own spreadsheet), not a broker's own
 * export format. Column order doesn't matter, header names do (case-
 * insensitive): "Fund Name", "Date", "Amount". An optional "Platform"
 * column is picked up if present.
 */
export async function parseMfBulkWorkbook(buffer: ArrayBuffer): Promise<MfBulkParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);

  const warnings: string[] = [];
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return { rows: [], warnings: ["The workbook has no sheets."] };
  }

  const header = findHeaderRow(sheet, REQUIRED_HEADERS);
  if (!header) {
    return {
      rows: [],
      warnings: ['Could not find columns named "Fund Name", "Date" and "Amount".'],
    };
  }

  const col = (name: string) => header.colByHeader.get(name)!;
  const rows: MfBulkRow[] = [];

  for (let rowNumber = header.rowNumber + 1; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const fundNameRaw = cellText(row.getCell(col("fund name")).value);
    if (!fundNameRaw) continue; // blank row — end of table

    const txnDate = toISODate(row.getCell(col("date")).value);
    const amount = cellNumber(row.getCell(col("amount")).value);

    if (!txnDate) {
      warnings.push(`Row ${rowNumber}: could not read the date, skipped.`);
      continue;
    }
    if (amount <= 0) {
      warnings.push(`Row ${rowNumber}: amount is missing or zero, skipped.`);
      continue;
    }

    rows.push({ rowNumber, fundNameRaw, txn_date: txnDate, amount });
  }

  return { rows, warnings };
}
