/**
 * The correctness suite against the BUILT corpus (§12.1):
 *   T1 — exhaustive answer-mapping over every question and every index
 *   T2 — ETL round-trip against an oracle independent of the `cop` path
 *   T6 — checksum: mutate one answer, assert the app refuses to serve
 *
 * These run against data/build/corpus.sqlite. In CI the corpus must exist; a
 * missing corpus is a build failure, not a reason to quietly pass.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { correctOptionText, isCorrect } from '@/lib/core/verdict';
import { questionFromRow, type QuestionRow } from '@/lib/core/question';
import { ANSWER_INDICES } from '@/lib/core/answer-index';
import { verifyIntegrity } from '@/lib/db/integrity';
import { checkAnswerHistogram } from '@/lib/parser/cop-base';
import type { AnswerIndex, BuildManifest } from '@/types';

const BUILD_DIR = path.join(process.cwd(), 'data', 'build');
const DB_PATH = path.join(BUILD_DIR, 'corpus.sqlite');
const MANIFEST_PATH = path.join(BUILD_DIR, 'manifest.json');
const ORACLE_PATH = path.join(process.cwd(), 'tests', 'fixtures', 't2-answer-oracle.json');

const corpusExists = fs.existsSync(DB_PATH) && fs.existsSync(MANIFEST_PATH);

if (!corpusExists) {
  if (process.env['CI'] === 'true') {
    throw new Error(
      'corpus.sqlite is missing. The correctness suite is mandatory in CI (§12.1 T1). Run `pnpm data:build`.'
    );
  }
  console.warn(
    '\n  ⚠  data/build/corpus.sqlite not found — skipping T1/T2/T6.\n' +
      '     Run `pnpm data:build` to enable the correctness suite locally.\n'
  );
}

describe.skipIf(!corpusExists)('built corpus', () => {
  let db: Database.Database;
  let manifest: BuildManifest;

  beforeAll(() => {
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as BuildManifest;
  });

  afterAll(() => {
    db.close();
  });

  // -------------------------------------------------------------------------
  // T1 — exhaustive answer-mapping test
  // -------------------------------------------------------------------------
  it('T1 — isCorrect(q, i) === (i === answerIndex) for every question and every index', () => {
    const stmt = db.prepare('SELECT * FROM questions');
    let rows = 0;
    let assertions = 0;
    let mismatches = 0;
    const failures: string[] = [];

    for (const raw of stmt.iterate() as Iterable<QuestionRow>) {
      const q = questionFromRow(raw);
      rows++;
      for (const i of ANSWER_INDICES) {
        assertions++;
        const expected = i === raw.answer_index;
        if (isCorrect(q, i) !== expected) {
          mismatches++;
          if (failures.length < 10) failures.push(`${q.id}: isCorrect(q, ${i}) !== ${String(expected)}`);
        }
      }
      // The displayed correct answer must always be the option at that index.
      if (correctOptionText(q) !== [raw.opt_a, raw.opt_b, raw.opt_c, raw.opt_d][raw.answer_index]) {
        mismatches++;
        if (failures.length < 10) failures.push(`${q.id}: correctOptionText disagrees with the row`);
      }
    }

    expect(failures).toEqual([]);
    expect(mismatches).toBe(0);
    expect(rows).toBe(manifest.counts.accepted);
    expect(assertions).toBe(rows * 4);
    // Guard against the test silently passing over an empty corpus — scoped per
    // source rather than one combined figure, so a source that silently dropped
    // to zero rows (and was masked by the other source's volume) is caught.
    expect(manifest.sources.medmcqa.counts.accepted).toBeGreaterThan(150_000);
    expect(manifest.sources.usmle.counts.accepted).toBeGreaterThan(10_000);
  });

  // -------------------------------------------------------------------------
  // T2 — ETL round-trip against an independent oracle
  //
  // MedMCQA only, structurally: the oracle is built from the answer marker
  // parsed out of MedMCQA's `exp` field (§H1's semantic cross-check), and
  // USMLE carries no explanation field for such a marker to exist in — there
  // is nothing here for USMLE data to be checked against. USMLE's answer
  // resolution is unit-tested directly instead (`tests/unit/usmle.test.ts`),
  // since it is a simple, unambiguous letter lookup with no H1-style hazard
  // to cross-check in the first place (DECISIONS.md D-025).
  // -------------------------------------------------------------------------
  it('T2 — options[answerIndex] matches the answer stated in the source explanation', () => {
    const oracle = JSON.parse(fs.readFileSync(ORACLE_PATH, 'utf8')) as {
      rows: { id: string; markerLetter: string; expectedCorrectOptionText: string }[];
    };
    expect(oracle.rows.length).toBeGreaterThanOrEqual(1000);

    const get = db.prepare('SELECT * FROM questions WHERE id = ?');
    let found = 0;
    const unflagged: string[] = [];
    const flaggedAsSuspect: string[] = [];

    for (const row of oracle.rows) {
      const dbRow = get.get(row.id) as QuestionRow | undefined;
      if (dbRow === undefined) continue; // rejected by validation; not a mismatch
      found++;
      const q = questionFromRow(dbRow);
      if (correctOptionText(q) === row.expectedCorrectOptionText) continue;

      const description =
        `${row.id}: corpus says "${correctOptionText(q)}", ` +
        `explanation says (${row.markerLetter}) "${row.expectedCorrectOptionText}"`;

      // A disagreement is tolerable ONLY if the corpus already knows this record
      // is suspect and warns the user about it. An UNflagged disagreement means
      // the app would confidently display an answer its own source contradicts.
      if (q.flags.includes('conflicting_answer_variant')) flaggedAsSuspect.push(description);
      else unflagged.push(description);
    }

    // A wrong copIndexBase would break essentially every one of these.
    expect(unflagged).toEqual([]);
    expect(found).toBeGreaterThanOrEqual(950);

    // Empirical confirmation of H9 (DECISIONS.md D-004): the disagreements that
    // do exist are upstream label errors, and the corpus flags every one of them.
    // The rate is a regression guard — if it climbs, something else is wrong.
    expect(flaggedAsSuspect.length / found).toBeLessThan(0.01);
    if (flaggedAsSuspect.length > 0) {
      console.info(
        `  T2: ${flaggedAsSuspect.length}/${found} oracle disagreements, all flagged conflicting_answer_variant:\n` +
          flaggedAsSuspect.map((m) => `      ${m}`).join('\n')
      );
    }
  });

  // -------------------------------------------------------------------------
  // T6 — checksum
  // -------------------------------------------------------------------------
  describe('T6 — integrity checksum', () => {
    let tmpDir: string;
    let tamperedPath: string;

    beforeAll(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'medmcqa-t6-'));
      tamperedPath = path.join(tmpDir, 'corpus.sqlite');
      fs.copyFileSync(DB_PATH, tamperedPath);
    });

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('passes on the pristine database', () => {
      const result = verifyIntegrity(db, manifest);
      expect(result.problems).toEqual([]);
      expect(result.ok).toBe(true);
      expect(result.computed).toBe(manifest.answerKeyHash);
      expect(result.fromMeta).toBe(manifest.answerKeyHash);
    });

    it('FAILS after a single answer is altered', () => {
      const tampered = new Database(tamperedPath);
      const victim = tampered.prepare('SELECT id, answer_index FROM questions LIMIT 1').get() as {
        id: string;
        answer_index: number;
      };
      const newAnswer = (victim.answer_index + 1) % 4;
      tampered.prepare('UPDATE questions SET answer_index = ? WHERE id = ?').run(newAnswer, victim.id);

      const result = verifyIntegrity(tampered, manifest);
      expect(result.ok).toBe(false);
      expect(result.problems.join(' ')).toMatch(/answerKeyHash mismatch/);
      expect(result.computed).not.toBe(manifest.answerKeyHash);
      tampered.close();
    });

    it('FAILS when a row is deleted', () => {
      const tmp2 = path.join(tmpDir, 'deleted.sqlite');
      fs.copyFileSync(DB_PATH, tmp2);
      const tampered = new Database(tmp2);
      tampered.prepare('DELETE FROM questions WHERE rowid = (SELECT MIN(rowid) FROM questions)').run();

      const result = verifyIntegrity(tampered, manifest);
      expect(result.ok).toBe(false);
      expect(result.problems.join(' ')).toMatch(/mismatch|accepted rows/);
      tampered.close();
    });

    it('FAILS when the meta hash is rewritten to match tampered answers', () => {
      // The attack the two-sided check exists for: change the answers AND the
      // in-database hash. The manifest still disagrees.
      const tmp3 = path.join(tmpDir, 'both.sqlite');
      fs.copyFileSync(DB_PATH, tmp3);
      const tampered = new Database(tmp3);
      const victim = tampered.prepare('SELECT id, answer_index FROM questions LIMIT 1').get() as {
        id: string;
        answer_index: number;
      };
      tampered
        .prepare('UPDATE questions SET answer_index = ? WHERE id = ?')
        .run((victim.answer_index + 2) % 4, victim.id);
      const recomputed = verifyIntegrity(tampered, null).computed;
      tampered.prepare("UPDATE meta SET value = ? WHERE key = 'answerKeyHash'").run(recomputed);

      const result = verifyIntegrity(tampered, manifest);
      expect(result.ok).toBe(false);
      expect(result.problems.join(' ')).toMatch(/manifest\.json/);
      tampered.close();
    });
  });

  // -------------------------------------------------------------------------
  // Corpus invariants restated as tests (§5.3, H2, H6, H9)
  // -------------------------------------------------------------------------
  describe('corpus invariants', () => {
    it('every answer_index is in {0,1,2,3}', () => {
      const bad = db.prepare('SELECT COUNT(*) n FROM questions WHERE answer_index NOT IN (0,1,2,3)').get() as {
        n: number;
      };
      expect(bad.n).toBe(0);
    });

    it('the correct option is never empty', () => {
      const bad = db
        .prepare(
          `SELECT COUNT(*) n FROM questions
           WHERE TRIM(CASE answer_index WHEN 0 THEN opt_a WHEN 1 THEN opt_b WHEN 2 THEN opt_c ELSE opt_d END) = ''`
        )
        .get() as { n: number };
      expect(bad.n).toBe(0);
    });

    it('ids are unique', () => {
      const r = db.prepare('SELECT COUNT(*) total, COUNT(DISTINCT id) distinct_ids FROM questions').get() as {
        total: number;
        distinct_ids: number;
      };
      expect(r.distinct_ids).toBe(r.total);
    });

    it('the global split vocabulary is exactly train/validation', () => {
      // Reworded from "the test split is absent from the corpus entirely"
      // (D-021/D-022): that claim held when MedMCQA was the only source, but
      // USMLE's `test.jsonl` legitimately carries visible answers (unlike
      // MedMCQA's, which are withheld — H2) and folds into `validation`. The
      // assertion that still holds unconditionally is narrower: the *global*
      // Split vocabulary never grows a third value, and no MedMCQA row ever
      // carries a withheld-ground-truth split.
      const splits = db.prepare('SELECT DISTINCT split FROM questions').all() as { split: string }[];
      expect(splits.map((s) => s.split).sort()).toEqual(['train', 'validation']);

      const medmcqaBadSplit = db
        .prepare(`SELECT COUNT(*) n FROM questions WHERE source = 'medmcqa' AND split NOT IN ('train','validation')`)
        .get() as { n: number };
      expect(medmcqaBadSplit.n).toBe(0);
    });

    it('D-A — USMLE rows exist in both train and validation, proving the dev/test fold happened', () => {
      const usmleSplits = db
        .prepare(`SELECT DISTINCT split FROM questions WHERE source = 'usmle'`)
        .all() as { split: string }[];
      expect(usmleSplits.map((s) => s.split).sort()).toEqual(['train', 'validation']);

      // dev.jsonl (1,272) + test.jsonl (1,273) both fold into validation.
      const usmleValidation = db
        .prepare(`SELECT COUNT(*) n FROM questions WHERE source = 'usmle' AND split = 'validation'`)
        .get() as { n: number };
      expect(usmleValidation.n).toBe(1272 + 1273);
    });

    it('source facet/count sanity: per-source counts sum to the global total', () => {
      const rows = db
        .prepare('SELECT source, COUNT(*) n FROM questions GROUP BY source')
        .all() as { source: string; n: number }[];
      const bySource = Object.fromEntries(rows.map((r) => [r.source, r.n]));

      expect(bySource['medmcqa']).toBe(manifest.sources.medmcqa.counts.accepted);
      expect(bySource['usmle']).toBe(manifest.sources.usmle.counts.accepted);
      expect((bySource['medmcqa'] ?? 0) + (bySource['usmle'] ?? 0)).toBe(manifest.counts.accepted);
    });

    it('D-024 — dedup/conflict detection never crosses a source boundary', () => {
      // The positive proof that per-source DuplicateIndex scoping worked: no
      // duplicate_of pointer, and no conflicting-answer pairing, ever spans two
      // different `source` values. Without this, a MedMCQA question and an
      // unrelated USMLE question could theoretically be flagged as duplicates
      // of each other purely by textual coincidence.
      const crossSourceDup = db
        .prepare(
          `SELECT COUNT(*) n FROM questions d
           JOIN questions c ON c.id = d.duplicate_of
           WHERE d.duplicate_of IS NOT NULL AND d.source != c.source`
        )
        .get() as { n: number };
      expect(crossSourceDup.n).toBe(0);
    });

    it('§5.3 assertion 4 — the answer histogram shows no off-by-one signature', () => {
      const rows = db
        .prepare('SELECT answer_index i, COUNT(*) n FROM questions GROUP BY answer_index ORDER BY answer_index')
        .all() as { i: AnswerIndex; n: number }[];
      const counts: [number, number, number, number] = [0, 0, 0, 0];
      for (const r of rows) counts[r.i] = r.n;
      const check = checkAnswerHistogram(counts);
      expect(check.ok).toBe(true);
      expect(counts).toEqual([...manifest.answerIndexHistogram]);
    });

    it('H6 — duplicates point at a canonical record that exists and is itself canonical', () => {
      const orphan = db
        .prepare(
          `SELECT COUNT(*) n FROM questions d
           WHERE d.duplicate_of IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM questions c WHERE c.id = d.duplicate_of AND c.duplicate_of IS NULL)`
        )
        .get() as { n: number };
      expect(orphan.n).toBe(0);
    });

    it('H6/H9 — no duplicate or conflicting record is session-eligible', () => {
      const leaked = db
        .prepare(
          `SELECT COUNT(*) n FROM questions
           WHERE session_eligible = 1
             AND (duplicate_of IS NOT NULL OR flags LIKE '%conflicting_answer_variant%')`
        )
        .get() as { n: number };
      expect(leaked.n).toBe(0);
    });

    it('H9 — conflicting-answer flags are applied to EVERY member of a group, canonical included', () => {
      const flaggedCanonical = db
        .prepare(
          `SELECT COUNT(*) n FROM questions
           WHERE flags LIKE '%conflicting_answer_variant%' AND duplicate_of IS NULL`
        )
        .get() as { n: number };
      // Every conflicting group has exactly one canonical member.
      expect(flaggedCanonical.n).toBe(manifest.counts.conflictingAnswerGroups);
      expect(flaggedCanonical.n).toBeGreaterThan(0);
    });

    it('manifest counts agree with the database', () => {
      const total = db.prepare('SELECT COUNT(*) n FROM questions').get() as { n: number };
      const eligible = db.prepare('SELECT COUNT(*) n FROM questions WHERE session_eligible = 1').get() as {
        n: number;
      };
      const dupes = db.prepare('SELECT COUNT(*) n FROM questions WHERE duplicate_of IS NOT NULL').get() as {
        n: number;
      };
      expect(total.n).toBe(manifest.counts.accepted);
      expect(eligible.n).toBe(manifest.counts.sessionEligible);
      expect(dupes.n).toBe(manifest.counts.duplicates);
    });

    it('I4 — the rejection rate stayed under 2%, blended and per source (D-027)', () => {
      const answerable = manifest.counts.accepted + manifest.counts.rejected;
      expect(manifest.counts.rejected / answerable).toBeLessThan(0.02);

      // Per-source, independently — a source-specific ingestion bug could
      // clear a blended global rate while quietly failing within that source
      // alone (D-027's small-source-hides-in-the-average risk).
      for (const source of ['medmcqa', 'usmle'] as const) {
        const s = manifest.sources[source].counts;
        const sourceAnswerable = s.accepted + s.rejected;
        if (sourceAnswerable === 0) continue;
        expect(s.rejected / sourceAnswerable).toBeLessThan(0.02);
      }
    });

    it('H1 — the manifest records the resolved index base and its evidence', () => {
      expect(manifest.copIndexBase).toBe(1);
      expect(manifest.copDiagnostics.rangeMin).toBe(1);
      expect(manifest.copDiagnostics.rangeMax).toBe(4);
      expect(manifest.copDiagnostics.markerAgree1).toBeGreaterThan(
        manifest.copDiagnostics.markerAgree0 * 3
      );
    });

    it('FTS5 search returns relevant rows', () => {
      const hits = db
        .prepare(
          `SELECT q.id, q.stem FROM questions_fts f
           JOIN questions q ON q.rowid = f.rowid
           WHERE questions_fts MATCH ? ORDER BY bm25(questions_fts) LIMIT 5`
        )
        .all('narcolepsy') as { id: string; stem: string }[];
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.some((h) => /narcoleps/i.test(h.stem))).toBe(true);
    });
  });
});
