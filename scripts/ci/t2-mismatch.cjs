/** Print any T2 oracle rows the ETL disagrees with, for human adjudication. */
const D = require('better-sqlite3');
const fs = require('node:fs');
const db = new D('data/build/corpus.sqlite', { readonly: true });
const oracle = JSON.parse(fs.readFileSync('tests/fixtures/t2-answer-oracle.json', 'utf8'));
const get = db.prepare('SELECT * FROM questions WHERE id = ?');

let found = 0;
const bad = [];
for (const row of oracle.rows) {
  const r = get.get(row.id);
  if (!r) continue;
  found++;
  const actual = [r.opt_a, r.opt_b, r.opt_c, r.opt_d][r.answer_index];
  if (actual !== row.expectedCorrectOptionText) bad.push({ row, r, actual });
}
console.log(`found ${found}/${oracle.rows.length}, mismatches ${bad.length}\n`);
for (const b of bad) {
  console.log(`id=${b.row.id}`);
  console.log(`  stem      : ${b.r.stem}`);
  console.log(`  options   : A=${b.r.opt_a} | B=${b.r.opt_b} | C=${b.r.opt_c} | D=${b.r.opt_d}`);
  console.log(`  ETL answer: index ${b.r.answer_index} => "${b.actual}"`);
  console.log(`  oracle    : (${b.row.markerLetter}) => "${b.row.expectedCorrectOptionText}"`);
  console.log(`  exp head  : ${b.row.explanationHead}`);
  console.log(`  flags     : ${b.r.flags}`);
  console.log();
}
