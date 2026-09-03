import ExcelJS from "exceljs";

export function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "text" in value) return String(value.text ?? "");
  return String(value).trim();
}

export function cellNumber(value: ExcelJS.CellValue): number {
  const n = Number(cellText(value));
  return Number.isFinite(n) ? n : 0;
}

export function toISODate(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "string" && value.trim()) {
    const v = value.trim();
    // DD-MM-YYYY, optionally with a time suffix — e.g. Groww's
    // "06-04-2026 09:26 AM". Checked before generic parsing because
    // JS's Date constructor doesn't reliably handle DD-MM-YYYY and can
    // silently misread it as MM-DD-YYYY.
    const ddmm = v.match(/^(\d{2})-(\d{2})-(\d{4})/);
    if (ddmm) {
      const [, dd, mm, yyyy] = ddmm;
      return `${yyyy}-${mm}-${dd}`;
    }
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return "";
}

/**
 * Scans the first `maxScanRows` rows of a sheet looking for the header row —
 * the one whose cell text (lowercased) covers every entry in `required`.
 * Needed for exports like Zerodha's tradebook, which has a metadata block
 * (Client ID, date range) before the real table starts.
 *
 * Returns the header row number and a lowercase-header -> column-index map,
 * or null if no matching row was found within the scan window.
 */
export function findHeaderRow(
  sheet: ExcelJS.Worksheet,
  required: string[],
  maxScanRows = 40
): { rowNumber: number; colByHeader: Map<string, number> } | null {
  const requiredLower = required.map((r) => r.toLowerCase());

  for (let rowNumber = 1; rowNumber <= Math.min(maxScanRows, sheet.rowCount); rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const colByHeader = new Map<string, number>();

    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const text = cellText(cell.value).toLowerCase();
      if (text) colByHeader.set(text, colNumber);
    });

    const hasAll = requiredLower.every((r) => colByHeader.has(r));
    if (hasAll) return { rowNumber, colByHeader };
  }

  return null;
}
