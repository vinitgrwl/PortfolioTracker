import ExcelJS from "exceljs";
import { cellText, cellNumber, toISODate, findHeaderRow } from "./xlsx-utils";
import type { ParsedTransaction, ParseResult } from "./types";

const REQUIRED_HEADERS = [
  "scrip/contract",
  "buy/sell",
  "buy price",
  "sell price",
  "quantity",
  "brokerage",
  "order type",
  "segment",
  "date",
];

const FEE_HEADERS = [
  "brokerage",
  "gst",
  "stt",
  "sebi tax",
  "exchange turnover charges",
  "stamp duty",
  "other charges",
  "ipft charges",
];

/**
 * Parses AngelOne's "TradesAndCharges" export. Unlike Zerodha/Groww, this
 * file gives a full per-trade fee breakdown (Brokerage/GST/STT/Sebi
 * Tax/Exchange Turnover/Stamp Duty/Other/IPFT — summed into fiat_fees), so
 * its own trade log may be accurate enough for realized P&L without a
 * separate Tax P&L report.
 *
 * The trade-off (per the blueprint): no ISIN column, only the full
 * "Scrip/Contract" company name. Until the shared Company-Name → ISIN
 * lookup exists, these holdings are identified by that name and won't
 * automatically merge with the same company imported from a broker that
 * does give ISIN.
 *
 * Only Delivery + CAPITAL rows are imported — intraday/F&O trades (if
 * present) don't create standing holdings.
 */
export async function parseAngelOneWorkbook(buffer: ArrayBuffer): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);

  const warnings: string[] = [];
  const sheet = workbook.getWorksheet("TradesAndCharges") ?? workbook.worksheets[0];
  if (!sheet) {
    return { accountHint: null, transactions: [], warnings: ["The workbook has no sheets."] };
  }

  let accountHint: string | null = null;
  for (let r = 1; r <= Math.min(5, sheet.rowCount); r++) {
    const row = sheet.getRow(r);
    if (cellText(row.getCell(1).value) === "ClientCode") {
      const value = cellText(row.getCell(2).value);
      if (value) accountHint = value;
    }
  }

  const header = findHeaderRow(sheet, REQUIRED_HEADERS);
  if (!header) {
    return {
      accountHint,
      transactions: [],
      warnings: ['Could not find the trades table — is this AngelOne\'s "TradesAndCharges" export?'],
    };
  }

  const col = (name: string) => header.colByHeader.get(name)!;
  const has = (name: string) => header.colByHeader.has(name);
  const transactions: ParsedTransaction[] = [];
  let skippedNonDelivery = 0;

  for (let rowNumber = header.rowNumber + 1; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);

    const scrip = cellText(row.getCell(col("scrip/contract")).value);
    if (!scrip) continue; // blank row — end of table

    const orderType = cellText(row.getCell(col("order type")).value).toLowerCase();
    const segment = cellText(row.getCell(col("segment")).value).toLowerCase();
    if (orderType !== "delivery" || segment !== "capital") {
      skippedNonDelivery++;
      continue;
    }

    const side = cellText(row.getCell(col("buy/sell")).value).toLowerCase();
    const action = side === "buy" ? "buy" : side === "sell" ? "sell" : null;
    if (!action) {
      warnings.push(`Row ${rowNumber}: unrecognized Buy/Sell "${side}", skipped.`);
      continue;
    }

    const quantity = cellNumber(row.getCell(col("quantity")).value);
    const price =
      action === "buy"
        ? cellNumber(row.getCell(col("buy price")).value)
        : cellNumber(row.getCell(col("sell price")).value);

    const dateValue = row.getCell(col("date")).value;
    const txnDate = toISODate(dateValue);
    if (!txnDate) {
      warnings.push(`Row ${rowNumber}: could not read the date, skipped.`);
      continue;
    }

    let fees = 0;
    for (const h of FEE_HEADERS) {
      if (has(h)) fees += cellNumber(row.getCell(col(h)).value);
    }

    transactions.push({
      txn_date: txnDate,
      action,
      asset_ticker: scrip, // full company name — no short symbol/ISIN in this export
      isin: null,
      quantity,
      price,
      fiat_fees: Math.round(fees * 100) / 100,
      currency: "INR",
      country: "India",
      asset_class: "Stock",
      platform: "AngelOne",
    });
  }

  if (skippedNonDelivery > 0) {
    warnings.push(
      `${skippedNonDelivery} row(s) skipped — not Delivery/CAPITAL trades (intraday or F&O don't create standing holdings).`
    );
  }
  if (transactions.length > 0) {
    warnings.push(
      "No ISIN in this export — holdings are identified by company name, so they won't automatically merge with the same company imported from another broker yet."
    );
  }

  transactions.sort((a, b) => (a.txn_date < b.txn_date ? -1 : a.txn_date > b.txn_date ? 1 : 0));

  return { accountHint, transactions, warnings };
}
