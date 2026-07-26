/** Report per-table page usage in corpus.sqlite. Diagnostic only. */
const D = require('better-sqlite3');
const db = new D('data/build/corpus.sqlite', { readonly: true });
const pageSize = db.pragma('page_size', { simple: true });
const rows = db
  .prepare("SELECT name, SUM(pgsize) bytes FROM dbstat GROUP BY name ORDER BY bytes DESC")
  .all();
console.log('page_size', pageSize);
for (const r of rows) console.log(String(r.bytes).padStart(12), r.name);
console.log(String(rows.reduce((a, r) => a + r.bytes, 0)).padStart(12), 'TOTAL');
