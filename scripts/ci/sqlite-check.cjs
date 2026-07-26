/** Environment smoke check: confirms better-sqlite3 loads and FTS5 is compiled in. */
const D = require('better-sqlite3');
const db = new D(':memory:');
console.log('sqlite version:', db.prepare('select sqlite_version() v').get().v);
db.exec("CREATE VIRTUAL TABLE t USING fts5(x, tokenize='porter unicode61')");
db.prepare('INSERT INTO t VALUES (?)').run('hypertension of the renal artery');
console.log('fts5 + porter:', db.prepare("SELECT x FROM t WHERE t MATCH 'renal'").get());
console.log('bm25:', db.prepare("SELECT bm25(t) b FROM t WHERE t MATCH 'renal'").get());
console.log('OK');
