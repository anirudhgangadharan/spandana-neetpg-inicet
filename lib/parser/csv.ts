/**
 * Minimal RFC 4180 CSV reader (§5.1 requires CSV and parquet-exported CSV
 * inputs alongside JSON-lines and JSON arrays). Pure — string in, rows out.
 *
 * A parquet-exported CSV is just a CSV; the only accommodation it needs is
 * tolerance of embedded newlines inside quoted fields, which RFC 4180 covers.
 *
 * Deliberately small. It handles quoting, doubled quotes, CRLF, and embedded
 * newlines, and does not attempt type inference — every value is a string, and
 * the schema detector infers roles from there. The one exception is that a bare
 * integer becomes a number, because the answer field must present as an integer
 * for `detectSchema` to recognise it.
 */

/** Split CSV text into rows of raw string cells. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  // Strip a UTF-8 BOM if present.
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    // `endField` always pushes, so `row` holds at least one cell from here on.
    endField();
    // Ignore the trailing empty row produced by a final newline.
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field.length === 0) {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      endField();
      i++;
      continue;
    }
    if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      endRow();
      i++;
      continue;
    }
    if (ch === '\n') {
      endRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field.length > 0 || row.length > 0) endRow();
  return rows;
}

const INTEGER_RE = /^-?\d{1,15}$/;

/**
 * Convert rows to records keyed by the header row. Empty cells become `null`
 * so they are indistinguishable from JSON nulls downstream — a missing topic in
 * a CSV export and a missing topic in JSONL must validate identically.
 */
export function csvToRecords(text: string): Record<string, unknown>[] {
  const rows = parseCsvRows(text);
  const header = rows[0];
  if (header === undefined) return [];

  const out: Record<string, unknown>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r] as string[];
    const rec: Record<string, unknown> = {};
    for (let c = 0; c < header.length; c++) {
      const key = header[c] as string;
      const raw = cells[c];
      if (raw === undefined || raw.length === 0) {
        rec[key] = null;
      } else if (INTEGER_RE.test(raw)) {
        rec[key] = Number.parseInt(raw, 10);
      } else {
        rec[key] = raw;
      }
    }
    out.push(rec);
  }
  return out;
}
