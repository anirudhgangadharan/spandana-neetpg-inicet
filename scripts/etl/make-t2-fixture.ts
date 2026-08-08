/**
 * Generate the T2 round-trip fixture (§12.1).
 *
 * T2 needs "a fixed sample of >=1000 raw records with known-good manual answers".
 * The oracle must be INDEPENDENT of the `cop` -> answerIndex path, otherwise the
 * test proves only that the ETL agrees with itself and catches nothing.
 *
 * The independent oracle used here is the answer letter stated in the
 * explanation prose ("Ans. (c) Vitamin B12"). That letter is written by the
 * dataset's human authors and never passes through `cop`. The fixture stores the
 * EXPECTED CORRECT OPTION TEXT resolved from that letter, so the test asserts:
 *
 *     etlOutput.options[etlOutput.answerIndex] === textTheExplanationNames
 *
 * If the ETL ever flips the index base, every one of these 1,000 rows breaks.
 *
 * Records whose explanation names multiple letters ("Ans. is 'a' ... 'b' ...")
 * are excluded: those are H3's multi-answer labelling mess and the oracle is
 * genuinely ambiguous for them, so including them would test noise.
 *
 * Run: pnpm tsx scripts/etl/make-t2-fixture.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAnswerMarker } from '@/lib/parser/cop-base';
import { toPlainText } from '@/lib/utils/sanitise';
import { detectFormat, streamRecords } from './read';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = path.join(ROOT, 'data', 'raw', 'medmcqa', 'train.json');
const OUT = path.join(ROOT, 'tests', 'fixtures', 't2-answer-oracle.json');
const TARGET = 1000;
/** Take every Nth qualifying record so the sample spans the whole file. */
const STRIDE = 37;

/** A second letter mentioned later in the marker region means the oracle is ambiguous. */
const SECOND_LETTER = /\b(?:and|&|;|,)\s*['"‘’“”(\[]*\s*([a-d])['"‘’“”)\]]/i;

async function main(): Promise<void> {
  const format = await detectFormat(SOURCE);
  const rows: {
    id: string;
    markerLetter: string;
    expectedCorrectOptionText: string;
    stem: string;
    explanationHead: string;
  }[] = [];

  let qualifying = 0;
  for await (const item of streamRecords(SOURCE, format)) {
    if (!item.ok) continue;
    const r = item.rec as Record<string, unknown>;
    const exp = r['exp'];
    if (typeof exp !== 'string') continue;

    const marker = parseAnswerMarker(exp);
    if (marker === null) continue;

    const head = exp.slice(0, 200);
    if (SECOND_LETTER.test(head)) continue; // ambiguous multi-answer explanation

    const options = [r['opa'], r['opb'], r['opc'], r['opd']].map((v) => toPlainText(v as string));
    if (options.some((o) => o.length === 0)) continue;
    if (new Set(options).size !== 4) continue;

    const expected = options[marker];
    if (expected === undefined) continue;

    qualifying++;
    if (qualifying % STRIDE !== 0) continue;

    rows.push({
      id: String(r['id']),
      markerLetter: 'abcd'[marker] as string,
      expectedCorrectOptionText: expected,
      stem: toPlainText(r['question'] as string).slice(0, 160),
      explanationHead: toPlainText(exp).slice(0, 160),
    });
    if (rows.length >= TARGET) break;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        note:
          'T2 oracle. `expectedCorrectOptionText` is resolved from the answer letter stated in the ' +
          "record's explanation prose, NOT from `cop`. This makes the fixture independent of the " +
          'index-base decision under test. Regenerate with scripts/etl/make-t2-fixture.ts.',
        sourceFile: 'train.json',
        stride: STRIDE,
        count: rows.length,
        rows,
      },
      null,
      2
    )
  );
  console.log(`wrote ${rows.length} oracle rows to ${path.relative(ROOT, OUT)} (from ${qualifying} qualifying records)`);

  console.log('\n--- 30 rows for manual verification (§12.1 T2) ---');
  for (let i = 0; i < 30 && i < rows.length; i++) {
    const row = rows[i];
    if (row === undefined) continue;
    console.log(`\n[${i + 1}] ${row.id}  marker=(${row.markerLetter})`);
    console.log(`   Q  : ${row.stem}`);
    console.log(`   ANS: ${row.expectedCorrectOptionText}`);
    console.log(`   EXP: ${row.explanationHead}`);
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
