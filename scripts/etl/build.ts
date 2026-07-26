/**
 * Build-time ETL (spec §3.1). Runs offline via `pnpm data:build`.
 *
 * NOT part of the Next.js runtime. Plain Node/TypeScript with its own tests.
 * Output is deterministic: the same input produces the same corpus.sqlite.
 *
 *   data/raw/*.json  ─▶  ETL  ─▶  data/build/corpus.sqlite
 *                                 data/build/manifest.json
 *                                 data/build/facets.json
 *                                 data/build/validation-report.json
 *                                 data/build/corruption-lexicon.json
 *
 * The pipeline makes three passes over the corpus rather than holding it in
 * memory:
 *   A. diagnostics  — cop range/histogram, answer-marker cross-check, token
 *                     frequencies for the H4 lexicon
 *   B. duplicate index — group records by normalised key, detect H9 conflicts
 *   C. write        — validate again and insert, now that corpus-wide facts
 *                     (duplicateOf, conflicting answers) are known
 *
 * Passes B and C re-run validation identically so that "the canonical record"
 * means "the first ACCEPTED record", not "the first record in the file".
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import type {
  AnswerIndex,
  BuildManifest,
  FacetsFile,
  QuestionFlag,
  Rejection,
  RejectionCode,
  Split,
} from '@/types';
import { computeAnswerKeyHash } from '@/lib/core/answer-key';
import { checkAnswerHistogram, parseAnswerMarker, resolveCopIndexBase } from '@/lib/parser/cop-base';
import { buildCorruptionLexicon, countTokensInto } from '@/lib/parser/corruption';
import { DuplicateIndex, duplicateKey } from '@/lib/parser/dedupe';
import { detectSchema, MIN_SCHEMA_CONFIDENCE, type SchemaDetection } from '@/lib/parser/schema';
import { validateRecord, type ValidationContext } from '@/lib/parser/validate';
import { toPlainText } from '@/lib/utils/sanitise';
import { detectFormat, discoverSources, sha256File, streamRecords, type SourceFormat } from './read';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW_DIR = path.join(ROOT, 'data', 'raw');
const BUILD_DIR = path.join(ROOT, 'data', 'build');
const APP_VERSION = '0.1.0';

/** §5.3 assertion 4 band. Outside this, halt. */
const HISTOGRAM_LOWER = 0.1;
const HISTOGRAM_UPPER = 0.4;
/** I4 — build fails above this rejection rate. */
const MAX_REJECTION_RATE = 0.02;
/** Flags that represent a data-quality warning worth filtering on. */
const QUALITY_WARNING_FLAGS: ReadonlySet<QuestionFlag> = new Set<QuestionFlag>([
  'possible_text_corruption',
  'conflicting_answer_variant',
  'two_distinct_options',
  'three_distinct_options',
  'markup_stripped',
]);

const num = (n: number): string => n.toLocaleString('en-US');
const t0 = Date.now();
const log = (msg = ''): void => {
  const s = ((Date.now() - t0) / 1000).toFixed(1).padStart(6);
  console.log(msg.length === 0 ? '' : `[${s}s] ${msg}`);
};
function boxed(lines: readonly string[]): string {
  const w = Math.max(...lines.map((l) => l.length));
  return [`┌─${'─'.repeat(w)}─┐`, ...lines.map((l) => `│ ${l.padEnd(w)} │`), `└─${'─'.repeat(w)}─┘`].join('\n');
}
function fail(message: string): never {
  console.error(`\n${boxed(['BUILD FAILED', ...message.split('\n')])}\n`);
  process.exit(1);
}

interface Source {
  readonly file: string;
  readonly name: string;
  readonly format: SourceFormat;
  readonly detection: SchemaDetection;
  readonly split: Split | null;
}

/** MedMCQA's `dev` is the validation split (§2.2). `test` never enters the corpus (H2). */
function splitFor(name: string): Split | null {
  const n = name.toLowerCase();
  if (n === 'train') return 'train';
  if (n === 'dev' || n === 'validation' || n === 'valid') return 'validation';
  return null;
}

async function main(): Promise<void> {
  log('=== MedMCQA ETL ===');
  fs.mkdirSync(BUILD_DIR, { recursive: true });

  // -------------------------------------------------------------------------
  // 0. Discover sources and detect their schemas
  // -------------------------------------------------------------------------
  const files = discoverSources(RAW_DIR);
  if (files.length === 0) fail(`No source files in ${RAW_DIR}. Extract the archive there first.`);

  const sources: Source[] = [];
  for (const file of files) {
    const name = path.basename(file).replace(/\.(json|jsonl|csv)$/i, '');
    const format = await detectFormat(file);
    const sample: unknown[] = [];
    for await (const item of streamRecords(file, format)) {
      if (item.ok) sample.push(item.rec);
      if (sample.length >= 2000) break;
    }
    const detection = detectSchema(sample);
    sources.push({ file, name, format, detection, split: splitFor(name) });

    log(`source ${name} (${format}): confidence ${detection.confidence}, answerable ${detection.answerable}`);
    log(`         stem="${detection.mapping.stem}" options=[${detection.mapping.options.join(',')}] answer="${detection.mapping.answer ?? '—'}"`);
    for (const r of detection.reasons) log(`         note: ${r}`);

    // An unanswerable source is a confidently-detected known case (H2), not a
    // parse failure — only answerable sources must clear the confidence bar.
    if (detection.answerable && detection.confidence < MIN_SCHEMA_CONFIDENCE) {
      fail(
        `Schema detection for ${name} scored ${detection.confidence}, below the ${MIN_SCHEMA_CONFIDENCE} threshold.\n` +
          detection.reasons.map((r) => `  - ${r}`).join('\n') +
          '\nRefusing to guess at the schema (§5.1).'
      );
    }
  }

  const corpusSources = sources.filter((s) => s.detection.answerable && s.split !== null);
  const excludedSources = sources.filter((s) => !s.detection.answerable || s.split === null);
  if (corpusSources.length === 0) fail('No answerable source files found; the corpus would be empty.');

  log();
  log(`corpus sources : ${corpusSources.map((s) => s.name).join(', ')}`);
  log(`excluded (H2)  : ${excludedSources.map((s) => s.name).join(', ') || 'none'}`);

  // -------------------------------------------------------------------------
  // Pass A — diagnostics: cop range/histogram, answer markers, token frequencies
  // -------------------------------------------------------------------------
  log();
  log('--- Pass A: diagnostics ---');
  let copMin = Number.POSITIVE_INFINITY;
  let copMax = Number.NEGATIVE_INFINITY;
  let copNulls = 0;
  const copHistogram = new Map<number, number>();
  let markerComparable = 0;
  let markerAgree1 = 0;
  let markerAgree0 = 0;
  const tokenCounts = new Map<string, number>();
  let rawRecordCount = 0;
  let parseFailures = 0;
  const perSourceRaw = new Map<string, number>();

  for (const src of sources) {
    let n = 0;
    for await (const item of streamRecords(src.file, src.format)) {
      if (!item.ok) {
        parseFailures++;
        continue;
      }
      n++;
      rawRecordCount++;
      const rec = item.rec as Record<string, unknown>;
      const m = src.detection.mapping;

      // Token frequencies come from the whole archive including the test split
      // and the explanations: more text yields better frequency estimates, and
      // the lexicon is only ever used to FLAG, never to alter text.
      if (m.stem !== null) countTokensInto(tokenCounts, toPlainText(rec[m.stem] as string));
      for (const k of m.options) countTokensInto(tokenCounts, toPlainText(rec[k] as string));
      if (m.explanation !== null) countTokensInto(tokenCounts, toPlainText(rec[m.explanation] as string));

      if (!src.detection.answerable || m.answer === null || src.split === null) continue;

      const cop = rec[m.answer];
      if (cop === null || cop === undefined) {
        copNulls++;
      } else if (typeof cop === 'number' && Number.isInteger(cop)) {
        copMin = Math.min(copMin, cop);
        copMax = Math.max(copMax, cop);
        copHistogram.set(cop, (copHistogram.get(cop) ?? 0) + 1);

        if (m.explanation !== null) {
          const marker = parseAnswerMarker(rec[m.explanation]);
          if (marker !== null) {
            markerComparable++;
            if (cop - 1 === marker) markerAgree1++;
            if (cop === marker) markerAgree0++;
          }
        }
      } else {
        copNulls++;
      }
    }
    perSourceRaw.set(src.name, n);
    log(`  ${src.name.padEnd(8)} ${num(n).padStart(8)} records`);
  }
  if (parseFailures > 0) log(`  parse failures: ${num(parseFailures)}`);

  // -------------------------------------------------------------------------
  // H1 — resolve the cop index base. Never guess.
  // -------------------------------------------------------------------------
  log();
  log('--- H1: resolving copIndexBase ---');
  const resolution = resolveCopIndexBase({
    min: copMin,
    max: copMax,
    nulls: copNulls,
    histogram: copHistogram,
    markerComparable,
    markerAgree1,
    markerAgree0,
  });
  for (const line of resolution.report) log(`  ${line}`);
  if (!resolution.ok) fail(`H1 UNRESOLVED — ${resolution.reason}\n\n${resolution.report.join('\n')}`);
  const copIndexBase = resolution.base;

  console.log(
    '\n' +
      boxed([
        `copIndexBase = ${copIndexBase}`,
        `answerIndex  = cop${copIndexBase === 1 ? ' - 1' : ''}`,
        `range        : [${copMin}, ${copMax}], ${copNulls} nulls`,
        `semantic     : ${resolution.semanticConfirmed ? 'CONFIRMED' : 'not confirmed (small sample)'} — ` +
          `${num(markerAgree1)} vs ${num(markerAgree0)} over n=${num(markerComparable)}`,
      ]) +
      '\n'
  );

  // -------------------------------------------------------------------------
  // H4 — derive the corruption lexicon from corpus token frequencies
  // -------------------------------------------------------------------------
  log('--- H4: deriving corruption lexicon ---');
  const lexiconEntries = buildCorruptionLexicon(tokenCounts);
  const lexicon = new Set(lexiconEntries.map((e) => e.corrupted));
  fs.writeFileSync(
    path.join(BUILD_DIR, 'corruption-lexicon.json'),
    JSON.stringify(
      {
        generatedFrom: 'corpus token frequencies',
        distinctTokens: tokenCounts.size,
        entryCount: lexiconEntries.length,
        note: 'Review this list. Detection FLAGS records; it never repairs text (§13 anti-requirement 5).',
        entries: lexiconEntries,
      },
      null,
      2
    )
  );
  log(`  ${num(tokenCounts.size)} distinct tokens → ${num(lexiconEntries.length)} corruption pairs`);
  log(`  top: ${lexiconEntries.slice(0, 12).map((e) => `${e.corrupted}→${e.intact}(${e.corruptedFreq})`).join(', ')}`);

  // -------------------------------------------------------------------------
  // Pass B — duplicate index (H6) and conflicting-answer detection (H9)
  // -------------------------------------------------------------------------
  log();
  log('--- Pass B: duplicate index ---');
  const duplicates = new DuplicateIndex();
  {
    const seenIds = new Set<string>();
    for (const src of corpusSources) {
      const ctx: ValidationContext = {
        mapping: src.detection.mapping,
        copIndexBase,
        split: src.split as Split,
        sourceAnswerable: true,
        seenIds,
        corruptionLexicon: lexicon,
      };
      for await (const item of streamRecords(src.file, src.format)) {
        if (!item.ok) continue;
        const result = validateRecord(item.rec, ctx);
        if (!result.ok) continue;
        const r = result.record;
        duplicates.add(duplicateKey(r.stem, r.options), r.id, r.answer);
      }
    }
  }
  const dupStats = duplicates.stats();
  log(`  ${num(dupStats.groups)} groups, ${num(dupStats.redundant)} redundant records`);
  log(`  H9: ${num(dupStats.conflictingGroups)} groups with CONFLICTING answers, covering ${num(dupStats.conflictingRecords)} records`);

  // -------------------------------------------------------------------------
  // Pass C — validate and write
  // -------------------------------------------------------------------------
  log();
  log('--- Pass C: writing corpus.sqlite ---');
  const dbPath = path.join(BUILD_DIR, 'corpus.sqlite');
  fs.rmSync(dbPath, { force: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = OFF');
  db.pragma('synchronous = OFF');
  db.exec(`
    CREATE TABLE questions (
      rowid            INTEGER PRIMARY KEY,
      id               TEXT    NOT NULL UNIQUE,
      split            TEXT    NOT NULL,
      stem             TEXT    NOT NULL,
      opt_a            TEXT    NOT NULL,
      opt_b            TEXT    NOT NULL,
      opt_c            TEXT    NOT NULL,
      opt_d            TEXT    NOT NULL,
      answer_index     INTEGER NOT NULL CHECK (answer_index BETWEEN 0 AND 3),
      explanation      TEXT,
      subject          TEXT    NOT NULL,
      topic            TEXT,
      choice_type      TEXT    NOT NULL CHECK (choice_type IN ('single','multi')),
      flags            TEXT    NOT NULL,
      duplicate_of     TEXT,
      session_eligible INTEGER NOT NULL CHECK (session_eligible IN (0,1)),
      quality_warning  INTEGER NOT NULL CHECK (quality_warning  IN (0,1))
    );
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);

  const insert = db.prepare(`
    INSERT INTO questions
      (id, split, stem, opt_a, opt_b, opt_c, opt_d, answer_index, explanation,
       subject, topic, choice_type, flags, duplicate_of, session_eligible, quality_warning)
    VALUES
      (@id, @split, @stem, @opt_a, @opt_b, @opt_c, @opt_d, @answer_index, @explanation,
       @subject, @topic, @choice_type, @flags, @duplicate_of, @session_eligible, @quality_warning)
  `);

  const rejections: Rejection[] = [];
  const rejectionCounts = new Map<RejectionCode, number>();
  const flagCounts = new Map<QuestionFlag, number>();
  const answerCounts: [number, number, number, number] = [0, 0, 0, 0];
  const answerKeyEntries: { id: string; answer: AnswerIndex }[] = [];
  let accepted = 0;
  let answerableRawCount = 0;
  let sessionEligibleCount = 0;

  const runPassC = db.transaction(
    (batch: readonly Record<string, string | number | null>[]) => {
      for (const row of batch) insert.run(row);
    }
  );

  {
    const seenIds = new Set<string>();
    let batch: Record<string, string | number | null>[] = [];

    for (const src of corpusSources) {
      const ctx: ValidationContext = {
        mapping: src.detection.mapping,
        copIndexBase,
        split: src.split as Split,
        sourceAnswerable: true,
        seenIds,
        corruptionLexicon: lexicon,
      };

      for await (const item of streamRecords(src.file, src.format)) {
        if (!item.ok) continue;
        answerableRawCount++;
        const result = validateRecord(item.rec, ctx);

        if (!result.ok) {
          rejectionCounts.set(result.code, (rejectionCounts.get(result.code) ?? 0) + 1);
          // Keep a bounded sample of full rejection detail; counts are exact.
          if (rejections.length < 500) {
            rejections.push({
              code: result.code,
              split: src.name,
              line: item.lineNo,
              id: result.id,
              detail: result.detail,
            });
          }
          continue;
        }

        const r = result.record;
        const key = duplicateKey(r.stem, r.options);
        const dupOf = duplicates.duplicateOf(key, r.id);
        const conflicting = duplicates.hasConflictingAnswers(key);

        const flags: QuestionFlag[] = [...r.flags];
        // H9 (D-004): flag EVERY member of a conflicting group, canonical
        // included. Being first in the file is not evidence of being right.
        if (conflicting) flags.push('conflicting_answer_variant');
        flags.sort();

        for (const f of flags) flagCounts.set(f, (flagCounts.get(f) ?? 0) + 1);
        answerCounts[r.answer]++;
        answerKeyEntries.push({ id: r.id, answer: r.answer });

        const eligible = dupOf === null && !conflicting;
        if (eligible) sessionEligibleCount++;
        const warning = flags.some((f) => QUALITY_WARNING_FLAGS.has(f));

        batch.push({
          id: r.id,
          split: r.split,
          stem: r.stem,
          opt_a: r.options[0],
          opt_b: r.options[1],
          opt_c: r.options[2],
          opt_d: r.options[3],
          answer_index: r.answer,
          explanation: r.explanation,
          subject: r.subject,
          topic: r.topic,
          choice_type: r.choiceType,
          flags: JSON.stringify(flags),
          duplicate_of: dupOf,
          session_eligible: eligible ? 1 : 0,
          quality_warning: warning ? 1 : 0,
        });
        accepted++;

        if (batch.length >= 5000) {
          runPassC(batch);
          batch = [];
        }
      }
    }
    if (batch.length > 0) runPassC(batch);
  }

  // Records in sources we never intended to ingest are a policy exclusion under
  // H2, not validation rejections — they are reported separately and are not in
  // the I4 denominator (matching Appendix A.9's projection).
  const excludedByPolicy = excludedSources.reduce((a, s) => a + (perSourceRaw.get(s.name) ?? 0), 0);

  log(`  accepted ${num(accepted)} / ${num(answerableRawCount)} answerable records`);
  log(`  rejected ${num(answerableRawCount - accepted)}`);
  for (const [code, n] of [...rejectionCounts.entries()].sort((a, b) => b[1] - a[1])) {
    log(`      ${code.padEnd(22)} ${num(n).padStart(7)}`);
  }
  log(`  excluded by policy (H2, unanswerable sources): ${num(excludedByPolicy)}`);

  // -------------------------------------------------------------------------
  // Indexes and FTS
  // -------------------------------------------------------------------------
  log();
  log('--- Building indexes and FTS5 ---');
  db.exec(`
    CREATE INDEX idx_q_subject   ON questions(subject, rowid);
    CREATE INDEX idx_q_topic     ON questions(topic, rowid);
    CREATE INDEX idx_q_split     ON questions(split, rowid);
    CREATE INDEX idx_q_eligible  ON questions(session_eligible, rowid);
    CREATE INDEX idx_q_warning   ON questions(quality_warning, rowid);
    CREATE INDEX idx_q_subj_elig ON questions(subject, session_eligible, rowid);
  `);
  db.exec(`
    CREATE VIRTUAL TABLE questions_fts USING fts5(
      stem, opt_a, opt_b, opt_c, opt_d, explanation,
      content='questions', content_rowid='rowid',
      tokenize='porter unicode61'
    );
    INSERT INTO questions_fts(rowid, stem, opt_a, opt_b, opt_c, opt_d, explanation)
      SELECT rowid, stem, opt_a, opt_b, opt_c, opt_d, explanation FROM questions;
    INSERT INTO questions_fts(questions_fts) VALUES('optimize');
  `);
  log('  done');

  // -------------------------------------------------------------------------
  // §5.3 Post-normalisation assertions — fail the build on violation
  // -------------------------------------------------------------------------
  log();
  log('--- §5.3 Post-normalisation assertions ---');

  const outOfRange = db.prepare('SELECT COUNT(*) n FROM questions WHERE answer_index NOT IN (0,1,2,3)').get() as { n: number };
  if (outOfRange.n !== 0) fail(`Assertion 1 FAILED: ${outOfRange.n} rows have answer_index outside {0,1,2,3}`);
  log('  1. every answerIndex ∈ {0,1,2,3} ......................... PASS');

  const emptyCorrect = db
    .prepare(
      `SELECT COUNT(*) n FROM questions
       WHERE TRIM(CASE answer_index WHEN 0 THEN opt_a WHEN 1 THEN opt_b WHEN 2 THEN opt_c ELSE opt_d END) = ''`
    )
    .get() as { n: number };
  if (emptyCorrect.n !== 0) fail(`Assertion 2 FAILED: ${emptyCorrect.n} rows have an empty correct option`);
  log('  2. options[answerIndex] is non-empty for every row ....... PASS');

  const idCounts = db.prepare('SELECT COUNT(*) total, COUNT(DISTINCT id) distinct_ids FROM questions').get() as {
    total: number;
    distinct_ids: number;
  };
  if (idCounts.total !== idCounts.distinct_ids) {
    fail(`Assertion 3 FAILED: ${idCounts.total} rows but only ${idCounts.distinct_ids} distinct ids`);
  }
  log(`  3. ids unique (${num(idCounts.total)} rows) ......................... PASS`);

  const hist = checkAnswerHistogram(answerCounts, HISTOGRAM_LOWER, HISTOGRAM_UPPER);
  log(`     histogram: ${hist.shares.map((s, i) => `${'ABCD'[i]}=${(s * 100).toFixed(2)}%`).join('  ')}`);
  if (!hist.ok) fail(`Assertion 4 FAILED: ${hist.message}`);
  log('  4. answer-index distribution within 10–40% band .......... PASS');

  const answerKeyHash = computeAnswerKeyHash(answerKeyEntries);
  if (answerKeyHash.length !== 64) fail('Assertion 5 FAILED: answerKeyHash is not a 64-char sha256');
  log(`  5. answerKeyHash written (${answerKeyHash.slice(0, 16)}…) ....... PASS`);

  // I4 — rejection-rate gate
  const rejectionRate = answerableRawCount === 0 ? 0 : (answerableRawCount - accepted) / answerableRawCount;
  log(`     rejection rate: ${(rejectionRate * 100).toFixed(4)}% (threshold ${MAX_REJECTION_RATE * 100}%)`);
  if (rejectionRate > MAX_REJECTION_RATE) {
    fail(
      `I4: rejection rate ${(rejectionRate * 100).toFixed(2)}% exceeds ${MAX_REJECTION_RATE * 100}%.\n` +
        'This demands human review — see data/build/validation-report.json.'
    );
  }

  // -------------------------------------------------------------------------
  // Facets
  // -------------------------------------------------------------------------
  log();
  log('--- Writing facets, manifest, validation report ---');

  const subjectRows = db
    .prepare('SELECT subject AS name, COUNT(*) AS count FROM questions GROUP BY subject ORDER BY count DESC')
    .all() as { name: string; count: number }[];
  const topicRows = db
    .prepare(
      `SELECT subject, COALESCE(topic, '') AS topic, COUNT(*) AS count
       FROM questions GROUP BY subject, topic ORDER BY subject, count DESC`
    )
    .all() as { subject: string; topic: string; count: number }[];
  const splitRows = db
    .prepare('SELECT split AS name, COUNT(*) AS count FROM questions GROUP BY split')
    .all() as { name: Split; count: number }[];

  const topicsBySubject: Record<string, { name: string; count: number }[]> = {};
  for (const row of topicRows) {
    const bucket = topicsBySubject[row.subject] ?? (topicsBySubject[row.subject] = []);
    // H5/D-008: a null topic is a real "Uncategorised" bucket, never dropped.
    bucket.push({ name: row.topic === '' ? 'Uncategorised' : row.topic, count: row.count });
  }

  const facets: FacetsFile = {
    subjects: subjectRows,
    topicsBySubject,
    flags: [...flagCounts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    splits: splitRows,
    total: accepted,
  };
  fs.writeFileSync(path.join(BUILD_DIR, 'facets.json'), JSON.stringify(facets, null, 2));

  const sourceFiles = await Promise.all(
    files.map(async (f) => ({
      file: path.basename(f),
      bytes: fs.statSync(f).size,
      sha256: await sha256File(f),
    }))
  );

  const manifest: BuildManifest = {
    builtAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    copIndexBase,
    copDiagnostics: {
      rangeMin: copMin,
      rangeMax: copMax,
      markerComparable,
      markerAgree1,
      markerAgree0,
    },
    sourceFiles,
    counts: {
      raw: rawRecordCount,
      accepted,
      rejected: answerableRawCount - accepted,
      duplicates: dupStats.redundant,
      conflictingAnswerGroups: dupStats.conflictingGroups,
      sessionEligible: sessionEligibleCount,
    },
    answerIndexHistogram: answerCounts,
    answerKeyHash,
  };
  fs.writeFileSync(path.join(BUILD_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

  fs.writeFileSync(
    path.join(BUILD_DIR, 'validation-report.json'),
    JSON.stringify(
      {
        generatedAt: manifest.builtAt,
        rawRecords: rawRecordCount,
        parseFailures,
        answerableRecords: answerableRawCount,
        accepted,
        rejected: answerableRawCount - accepted,
        rejectionRatePct: Number((rejectionRate * 100).toFixed(4)),
        rejectionThresholdPct: MAX_REJECTION_RATE * 100,
        excludedByPolicy: {
          count: excludedByPolicy,
          sources: excludedSources.map((s) => ({
            name: s.name,
            records: perSourceRaw.get(s.name) ?? 0,
            reason: 'H2 — ground truth withheld upstream; source carries no answer field',
          })),
        },
        rejectionsByCode: Object.fromEntries([...rejectionCounts.entries()].sort((a, b) => b[1] - a[1])),
        flagsByCode: Object.fromEntries([...flagCounts.entries()].sort((a, b) => b[1] - a[1])),
        duplicates: dupStats,
        sampleRejections: rejections,
      },
      null,
      2
    )
  );

  // Persist the integrity facts inside the database too, so the server can check
  // them without trusting a sidecar file that might be from a different build.
  const setMeta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  setMeta.run('answerKeyHash', answerKeyHash);
  setMeta.run('copIndexBase', String(copIndexBase));
  setMeta.run('appVersion', APP_VERSION);
  setMeta.run('accepted', String(accepted));

  db.exec('VACUUM');
  db.exec('ANALYZE');
  db.close();

  const dbBytes = fs.statSync(dbPath).size;
  log();
  console.log(
    boxed([
      'ETL COMPLETE',
      `corpus.sqlite      ${num(dbBytes)} bytes`,
      `accepted           ${num(accepted)}`,
      `rejected           ${num(answerableRawCount - accepted)}  (${(rejectionRate * 100).toFixed(4)}%)`,
      `excluded (H2)      ${num(excludedByPolicy)}`,
      `duplicates tagged  ${num(dupStats.redundant)}`,
      `H9 conflicts       ${num(dupStats.conflictingGroups)} groups / ${num(dupStats.conflictingRecords)} records`,
      `session-eligible   ${num(sessionEligibleCount)}`,
      `copIndexBase       ${copIndexBase}`,
      `answerKeyHash      ${answerKeyHash}`,
    ])
  );
  log();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
