/** Scratch: compare intact vs corrupted token frequencies for the A.7 probes. */
import fs from 'node:fs';
import readline from 'node:readline';

const counts = new Map();
const add = (t) => {
  for (const w of String(t ?? '').toLowerCase().match(/[a-z]+/g) ?? []) counts.set(w, (counts.get(w) ?? 0) + 1);
};

for (const file of ['train', 'dev', 'test']) {
  const rl = readline.createInterface({
    input: fs.createReadStream(`data/raw/medmcqa/${file}.json`, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    const r = JSON.parse(t);
    add(r.question); add(r.opa); add(r.opb); add(r.opc); add(r.opd); add(r.exp);
  }
}

const PAIRS = [
  ['aery', 'artery'], ['aeries', 'arteries'], ['hypeension', 'hypertension'],
  ['conve', 'convert'], ['impoant', 'important'], ['aerial', 'arterial'],
  ['paial', 'partial'], ['staed', 'started'], ['cailage', 'cartilage'],
  ['poal', 'portal'], ['suppoive', 'supportive'], ['veical', 'vertical'],
];
console.log('corrupted'.padEnd(14), 'freq'.padStart(7), '  intact'.padEnd(16), 'freq'.padStart(7), ' verdict');
for (const [c, i] of PAIRS) {
  const cf = counts.get(c) ?? 0;
  const inf = counts.get(i) ?? 0;
  console.log(
    c.padEnd(14), String(cf).padStart(7), '  ' + i.padEnd(14), String(inf).padStart(7),
    cf >= inf ? ' CORRUPT FORM DOMINATES' : ' intact dominates'
  );
}
