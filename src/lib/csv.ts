// T-402: CSV export (ST-03). Columns fixed by the PRD: url,platform,status,detected_language,
// transcript,error. Failed rows have status "failed" and a populated error column.
// Formula-injection guard per arch §7: cells beginning = + - @ or TAB get a leading apostrophe.

import type { Batch, Item } from "./types";

export const CSV_HEADER = "url,platform,status,detected_language,transcript,error";

const FORMULA_PREFIX = /^[=+\-@\t]/;

/** RFC-4180 quoting + spreadsheet formula-prefix guard. Exported for direct unit testing. */
export function csvCell(raw: string | undefined): string {
  let v = raw ?? "";
  if (FORMULA_PREFIX.test(v)) v = `'${v}`;
  if (/[",\r\n]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

/** Export status: processing states collapse to "processing" (the UI only enables export when settled). */
function exportStatus(item: Item): string {
  switch (item.status) {
    case "done":
    case "no_speech":
    case "failed":
    case "queued":
      return item.status;
    default:
      return "processing";
  }
}

function errorColumn(item: Item): string {
  if (item.status !== "failed" || !item.error) return "";
  return `${item.error.code}: ${item.error.message}`;
}

export function batchToCsv(batch: Batch): string {
  const rows = batch.items.map((item) =>
    [
      csvCell(item.url),
      csvCell(item.platform),
      csvCell(exportStatus(item)),
      csvCell(item.detectedLanguage),
      csvCell(item.transcript),
      csvCell(errorColumn(item)),
    ].join(","),
  );
  return [CSV_HEADER, ...rows].join("\r\n") + "\r\n";
}
