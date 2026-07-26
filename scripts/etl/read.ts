/**
 * ETL source readers. I/O lives here rather than in `lib/parser/` so that the
 * parser stays pure and can hold the 100% branch-coverage gate (§12.3).
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createHash } from 'node:crypto';
import { csvToRecords } from '@/lib/parser/csv';

export type SourceFormat = 'jsonl' | 'json-array' | 'csv';

export interface ReadItem {
  readonly lineNo: number;
  readonly ok: boolean;
  readonly rec?: unknown;
  readonly err?: string;
  readonly raw?: string;
}

/** Sniff the format from the first non-whitespace bytes. */
export async function detectFormat(filePath: string): Promise<SourceFormat> {
  const fd = await fs.promises.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(4096);
    const { bytesRead } = await fd.read(buf, 0, 4096, 0);
    const head = buf.subarray(0, bytesRead).toString('utf8').replace(/^﻿/, '').trimStart();
    if (head.startsWith('[')) return 'json-array';
    if (head.startsWith('{')) return 'jsonl';
    return 'csv';
  } finally {
    await fd.close();
  }
}

export async function* streamRecords(filePath: string, format: SourceFormat): AsyncGenerator<ReadItem> {
  if (format === 'json-array') {
    const parsed: unknown = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
    if (!Array.isArray(parsed)) {
      yield { lineNo: 1, ok: false, err: 'top-level value is not an array' };
      return;
    }
    for (let i = 0; i < parsed.length; i++) yield { lineNo: i + 1, ok: true, rec: parsed[i] };
    return;
  }

  if (format === 'csv') {
    const records = csvToRecords(await fs.promises.readFile(filePath, 'utf8'));
    for (let i = 0; i < records.length; i++) yield { lineNo: i + 2, ok: true, rec: records[i] };
    return;
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let lineNo = 0;
  for await (const line of rl) {
    lineNo++;
    const t = line.trim();
    if (t.length === 0) continue;
    try {
      yield { lineNo, ok: true, rec: JSON.parse(t) };
    } catch (err) {
      yield { lineNo, ok: false, err: err instanceof Error ? err.message : String(err), raw: t.slice(0, 200) };
    }
  }
}

/**
 * Source files in `data/raw`, sorted for determinism.
 * `__MACOSX/` and AppleDouble `._` siblings are archive cruft (Appendix A.1).
 */
export function discoverSources(rawDir: string): string[] {
  if (!fs.existsSync(rawDir)) return [];
  return fs
    .readdirSync(rawDir, { withFileTypes: true })
    .filter((d) => d.isFile() && /\.(json|jsonl|csv)$/i.test(d.name) && !d.name.startsWith('._'))
    .map((d) => path.join(rawDir, d.name))
    .sort();
}

export async function sha256File(filePath: string): Promise<string> {
  const h = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(filePath)
      .on('data', (chunk) => h.update(chunk))
      .on('end', () => resolve())
      .on('error', reject);
  });
  return h.digest('hex');
}
