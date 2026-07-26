/** Scratch: calibrate the "Ans. (x)" marker regex against real explanations. */
import fs from 'node:fs';
import readline from 'node:readline';

const Q = "['\"\\u2018\\u2019\\u201c\\u201d(\\[]";
const CANDIDATES = {
  v0_original: /\bans(?:wer)?\s*(?:is)?\s*[.:)\-–—]*\s*['''"(\[]?\s*([a-dA-D])\s*['''")\].]/,
  v1_loose: /\bans(?:wer)?\b[\s.:;)\-–—]*(?:is\b)?[\s.:;\-–—]*['"‘’“”(\[]*\s*([a-d])(?![a-z0-9])/i,
  v2_delimited: new RegExp(
    `\\bans(?:wer)?\\b[\\s.:;)\\-–—]*(?:is\\b)?[\\s.:;\\-–—]*${Q}*\\s*([a-d])\\s*(?=['\"\\u2018\\u2019\\u201c\\u201d)\\].,:;]|\\s|$)`,
    'i'
  ),
};

const rl = readline.createInterface({
  input: fs.createReadStream('data/raw/train.json', { encoding: 'utf8' }),
  crlfDelay: Infinity,
});

const stats = {};
for (const k of Object.keys(CANDIDATES)) stats[k] = { n: 0, a1: 0, a0: 0, misses: [] };

for await (const line of rl) {
  const t = line.trim();
  if (!t) continue;
  const r = JSON.parse(t);
  if (typeof r.exp !== 'string' || typeof r.cop !== 'number') continue;
  const head = r.exp.slice(0, 200);
  for (const [k, re] of Object.entries(CANDIDATES)) {
    const m = re.exec(head);
    if (!m) continue;
    const letter = m[1].toLowerCase().charCodeAt(0) - 97;
    const s = stats[k];
    s.n++;
    if (r.cop - 1 === letter) s.a1++;
    if (r.cop === letter) s.a0++;
    else if (r.cop - 1 !== letter && s.misses.length < 8) {
      s.misses.push(`cop=${r.cop} letter=${'abcd'[letter]} :: ${head.replace(/\s+/g, ' ').slice(0, 110)}`);
    }
  }
}

for (const [k, s] of Object.entries(stats)) {
  const p = (x) => (s.n ? ((x / s.n) * 100).toFixed(2) + '%' : '—');
  console.log(`\n${k}: n=${s.n.toLocaleString()}  1-based=${s.a1.toLocaleString()} (${p(s.a1)})  0-based=${s.a0.toLocaleString()} (${p(s.a0)})`);
  s.misses.forEach((m) => console.log(`   MISS ${m}`));
}
