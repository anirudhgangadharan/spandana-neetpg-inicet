/**
 * Build-time ETL (spec §3.1). Runs offline via `pnpm data:build`.
 *
 * NOT part of the Next.js runtime. Plain Node/TypeScript with its own tests.
 * Output is deterministic: the same input produces the same corpus.sqlite.
 *
 *   data/raw/medmcqa/*.json   ─┐
 *   data/raw/usmle/*.jsonl    ─┴─▶  ETL  ─▶  data/build/corpus.sqlite
 *                                            data/build/manifest.json
 *                                            data/build/facets.json
 *                                            data/build/validation-report.json
 *                                            data/build/corruption-lexicon.json
 *
 * Two independent question banks (`QuestionSource`) share one pipeline and one
 * output table, but nothing about how they're discovered, split, validated, or
 * deduplicated is shared implicitly — see DECISIONS.md D-021 through D-027.
 * MedMCQA's H1/H4 machinery (cop-index-base resolution, the corruption lexicon)
 * only ever sees MedMCQA records; USMLE's answer resolution is a small,
 * unambiguous letter lookup with no equivalent hazard.
 *
 * The pipeline makes three passes over the corpus rather than holding it in
 * memory:
 *   A. diagnostics  — cop range/histogram, answer-marker cross-check, token
 *                     frequencies for the H4 lexicon (MedMCQA files only)
 *   B. duplicate index — group records by normalised key, detect H9 conflicts
 *                     (one DuplicateIndex per source — never across sources)
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
  QuestionSource,
  Rejection,
  RejectionCode,
  SourceManifestEntry,
  Split,
} from '@/types';
import { computeAnswerKeyHash } from '@/lib/core/answer-key';
import { checkAnswerHistogram, parseAnswerMarker, resolveCopIndexBase } from '@/lib/parser/cop-base';
import { buildCorruptionLexicon, countTokensInto } from '@/lib/parser/corruption';
import { DuplicateIndex, duplicateKey } from '@/lib/parser/dedupe';
import { detectSchema, MIN_SCHEMA_CONFIDENCE, type SchemaDetection } from '@/lib/parser/schema';
import { validateRecord, type ValidationContext, type ValidationResult } from '@/lib/parser/validate';
import { validateUsmleRecord, type UsmleValidationContext } from '@/lib/parser/usmle';
import { toPlainText } from '@/lib/utils/sanitise';
import { detectFormat, discoverSources, sha256File, streamRecords, type DiscoveredFile, type SourceFormat } from './read';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW_DIR = path.join(ROOT, 'data', 'raw');
const BUILD_DIR = path.join(ROOT, 'data', 'build');
const APP_VERSION = '0.1.0';

const SOURCES: readonly QuestionSource[] = ['medmcqa', 'usmle'];

/** §5.3 assertion 4 band. Outside this, halt (MedMCQA only — see D-027). */
const HISTOGRAM_LOWER = 0.1;
const HISTOGRAM_UPPER = 0.4;
/** I4 — build fails above this rejection rate, evaluated PER SOURCE (D-027). */
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
  /** Raw basename, pre-fold (e.g. `train`, `dev`, `test`). */
  readonly name: string;
  readonly source: QuestionSource;
  readonly format: SourceFormat;
  /** Only present for `source === 'medmcqa'` — USMLE's schema is fixed by
   *  construction and validated record-by-record instead of structurally
   *  inferred (D-024). */
  readonly detection: SchemaDetection | null;
  readonly split: Split | null;
  readonly answerable: boolean;
}

/** Stable label for logs/rejection-sample provenance; also the `perSourceRaw`
 *  map key, since two sources can legitimately each have a file named `train`. */
const sourceKey = (src: Source): string => `${src.source}:${src.name}`;

/** MedMCQA's `dev` is the validation split (§2.2). `test` never enters the corpus (H2). */
function splitForMedmcqa(name: string): Split | null {
  const n = name.toLowerCase();
  if (n === 'train') return 'train';
  if (n === 'dev' || n === 'validation' || n === 'valid') return 'validation';
  return null;
}

/**
 * USMLE's `test.jsonl` — unlike MedMCQA's — carries real, visible answers, so
 * it is legitimately answerable data, not H2's withheld ground truth. This app
 * has no notion of "held out for model evaluation"; to a person practising,
 * dev and test are both just "more questions with visible answers" (D-021/D-022).
 * Both fold into `'validation'` rather than adding a third `Split` value.
 */
function splitForUsmle(name: string): Split | null {
  const n = name.toLowerCase();
  if (n === 'train') return 'train';
  if (n === 'dev' || n === 'test') return 'validation';
  return null;
}

/** Per-source accumulators, alongside (not replacing) the existing global ones. */
interface SourceAccumulator {
  accepted: number;
  answerableRaw: number;
  sessionEligible: number;
  answerCounts: [number, number, number, number];
  rejectionCounts: Map<RejectionCode, number>;
}
function newAccumulator(): SourceAccumulator {
  return { accepted: 0, answerableRaw: 0, sessionEligible: 0, answerCounts: [0, 0, 0, 0], rejectionCounts: new Map() };
}

async function main(): Promise<void> {
  log('=== Question corpus ETL (MedMCQA + USMLE) ===');
  fs.mkdirSync(BUILD_DIR, { recursive: true });

  // -------------------------------------------------------------------------
  // 0. Discover sources (per-directory, never per-filename — see read.ts) and
  //    detect MedMCQA's schema. USMLE's schema is fixed by construction.
  // -------------------------------------------------------------------------
  const discovered: DiscoveredFile[] = discoverSources(RAW_DIR);
  if (discovered.length === 0) {
    fail(`No source files under ${RAW_DIR}/<source>/. Expected data/raw/medmcqa/ and/or data/raw/usmle/.`);
  }

  const sources: Source[] = [];
  for (const { source, file } of discovered) {
    const name = path.basename(file).replace(/\.(json|jsonl|csv)$/i, '');
    const format = await detectFormat(file);

    if (source === 'medmcqa') {
      const sample: unknown[] = [];
      for await (const item of streamRecords(file, format)) {
        if (item.ok) sample.push(item.rec);
        if (sample.length >= 2000) break;
      }
      const detection = detectSchema(sample);
      const split = splitForMedmcqa(name);
      sources.push({ file, name, source, format, detection, split, answerable: detection.answerable });

      log(`source medmcqa/${name} (${format}): confidence ${detection.confidence}, answerable ${detection.answerable}`);
      log(`         stem="${detection.mapping.stem}" options=[${detection.mapping.options.join(',')}] answer="${detection.mapping.answer ?? '—'}"`);
      for (const r of detection.reasons) log(`         note: ${r}`);

      // An unanswerable source is a confidently-detected known case (H2), not a
      // parse failure — only answerable sources must clear the confidence bar.
      if (detection.answerable && detection.confidence < MIN_SCHEMA_CONFIDENCE) {
        fail(
          `Schema detection for medmcqa/${name} scored ${detection.confidence}, below the ${MIN_SCHEMA_CONFIDENCE} threshold.\n` +
            detection.reasons.map((r) => `  - ${r}`).join('\n') +
            '\nRefusing to guess at the schema (§5.1).'
        );
      }
    } else {
      // usmle: known, fixed schema — validated record-by-record in
      // validateUsmleRecord (D-024) rather than structurally inferred.
      const split = splitForUsmle(name);
      sources.push({ file, name, source, format, detection: null, split, answerable: true });
      log(`source usmle/${name} (${format}): fixed schema, split=${split ?? '(excluded — unrecognised file name)'}`);
    }
  }

  const corpusSources = sources.filter((s) => s.answerable && s.split !== null);
  const excludedSources = sources.filter((s) => !s.answerable || s.split === null);
  if (corpusSources.length === 0) fail('No answerable source files found; the corpus would be empty.');

  log();
  log(`corpus sources : ${corpusSources.map(sourceKey).join(', ')}`);
  log(`excluded (H2)  : ${excludedSources.map(sourceKey).join(', ') || 'none'}`);

  // -------------------------------------------------------------------------
  // Pass A — diagnostics: cop range/histogram, answer markers, token
  // frequencies. MedMCQA only (D-D/D-E) — USMLE has no equivalent hazard to
  // diagnose, so its records are counted here but otherwise skipped.
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
  const rawBySource: Record<QuestionSource, number> = { medmcqa: 0, usmle: 0 };

  for (const src of sources) {
    let n = 0;
    for await (const item of streamRecords(src.file, src.format)) {
      if (!item.ok) {
        parseFailures++;
        continue;
      }
      n++;
      rawRecordCount++;
      rawBySource[src.source]++;

      if (src.source !== 'medmcqa' || src.detection === null) continue;

      const rec = item.rec as Record<string, unknown>;
      const m = src.detection.mapping;

      // Token frequencies come from the whole MedMCQA archive including the
      // test split and the explanations: more text yields better frequency
      // estimates, and the lexicon is only ever used to FLAG, never to alter
      // text. USMLE tokens never enter this lexicon (D-D) — that defect is
      // specific to MedMCQA's provenance pipeline.
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
    perSourceRaw.set(sourceKey(src), n);
    log(`  ${sourceKey(src).padEnd(14)} ${num(n).padStart(8)} records`);
  }
  if (parseFailures > 0) log(`  parse failures: ${num(parseFailures)}`);

  // -------------------------------------------------------------------------
  // H1 — resolve the cop index base. Never guess. MedMCQA-specific.
  // -------------------------------------------------------------------------
  log();
  log('--- H1: resolving copIndexBase (medmcqa) ---');
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
  // H4 — derive the corruption lexicon from MedMCQA token frequencies only
  // -------------------------------------------------------------------------
  log('--- H4: deriving corruption lexicon (medmcqa only) ---');
  const lexiconEntries = buildCorruptionLexicon(tokenCounts);
  const lexicon = new Set(lexiconEntries.map((e) => e.corrupted));
  fs.writeFileSync(
    path.join(BUILD_DIR, 'corruption-lexicon.json'),
    JSON.stringify(
      {
        generatedFrom: 'medmcqa token frequencies only (D-D)',
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
  // Pass B — duplicate index (H6) and conflicting-answer detection (H9).
  // One DuplicateIndex PER SOURCE (D-D/D-024) — structurally impossible for a
  // MedMCQA question and a USMLE question to be flagged as duplicates of each
  // other, since they are never inserted into the same index.
  // -------------------------------------------------------------------------
  log();
  log('--- Pass B: duplicate index (per source) ---');
  const duplicatesBySource: Record<QuestionSource, DuplicateIndex> = {
    medmcqa: new DuplicateIndex(),
    usmle: new DuplicateIndex(),
  };
  {
    const seenIds = new Set<string>();
    for (const src of corpusSources) {
      if (src.source === 'medmcqa') {
        if (src.detection === null) continue;
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
          duplicatesBySource.medmcqa.add(duplicateKey(r.stem, r.options), r.id, r.answer);
        }
      } else {
        const ctx: UsmleValidationContext = { split: src.split as Split, seenIds };
        for await (const item of streamRecords(src.file, src.format)) {
          if (!item.ok) continue;
          const result = validateUsmleRecord(item.rec, src.name, ctx);
          if (!result.ok) continue;
          const r = result.record;
          duplicatesBySource.usmle.add(duplicateKey(r.stem, r.options), r.id, r.answer);
        }
      }
    }
  }
  const dupStatsBySource: Record<QuestionSource, ReturnType<DuplicateIndex['stats']>> = {
    medmcqa: duplicatesBySource.medmcqa.stats(),
    usmle: duplicatesBySource.usmle.stats(),
  };
  for (const s of SOURCES) {
    const ds = dupStatsBySource[s];
    log(
      `  ${s.padEnd(8)} ${num(ds.groups)} groups, ${num(ds.redundant)} redundant, ` +
        `H9: ${num(ds.conflictingGroups)} conflicting groups / ${num(ds.conflictingRecords)} records`
    );
  }

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
      source           TEXT    NOT NULL CHECK (source IN ('medmcqa','usmle')),
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
      (id, source, split, stem, opt_a, opt_b, opt_c, opt_d, answer_index, explanation,
       subject, topic, choice_type, flags, duplicate_of, session_eligible, quality_warning)
    VALUES
      (@id, @source, @split, @stem, @opt_a, @opt_b, @opt_c, @opt_d, @answer_index, @explanation,
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
  const sourceAcc: Record<QuestionSource, SourceAccumulator> = {
    medmcqa: newAccumulator(),
    usmle: newAccumulator(),
  };

  const runPassC = db.transaction(
    (batch: readonly Record<string, string | number | null>[]) => {
      for (const row of batch) insert.run(row);
    }
  );

  {
    const seenIds = new Set<string>();
    let batch: Record<string, string | number | null>[] = [];

    const processResult = (result: ValidationResult, src: Source, lineNo: number): void => {
      const acc = sourceAcc[src.source];
      if (!result.ok) {
        rejectionCounts.set(result.code, (rejectionCounts.get(result.code) ?? 0) + 1);
        acc.rejectionCounts.set(result.code, (acc.rejectionCounts.get(result.code) ?? 0) + 1);
        // Keep a bounded sample of full rejection detail; counts are exact.
        if (rejections.length < 500) {
          rejections.push({ code: result.code, split: sourceKey(src), line: lineNo, id: result.id, detail: result.detail });
        }
        return;
      }

      const r = result.record;
      const duplicates = duplicatesBySource[src.source];
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
      acc.answerCounts[r.answer]++;
      answerKeyEntries.push({ id: r.id, answer: r.answer });

      const eligible = dupOf === null && !conflicting;
      if (eligible) {
        sessionEligibleCount++;
        acc.sessionEligible++;
      }
      const warning = flags.some((f) => QUALITY_WARNING_FLAGS.has(f));

      batch.push({
        id: r.id,
        source: src.source,
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
      acc.accepted++;

      if (batch.length >= 5000) {
        runPassC(batch);
        batch = [];
      }
    };

    for (const src of corpusSources) {
      const acc = sourceAcc[src.source];

      if (src.source === 'medmcqa') {
        if (src.detection === null) continue;
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
          acc.answerableRaw++;
          processResult(validateRecord(item.rec, ctx), src, item.lineNo);
        }
      } else {
        const ctx: UsmleValidationContext = { split: src.split as Split, seenIds };
        for await (const item of streamRecords(src.file, src.format)) {
          if (!item.ok) continue;
          answerableRawCount++;
          acc.answerableRaw++;
          processResult(validateUsmleRecord(item.rec, src.name, ctx), src, item.lineNo);
        }
      }
    }
    if (batch.length > 0) runPassC(batch);
  }

  // Records in sources we never intended to ingest are a policy exclusion under
  // H2, not validation rejections — they are reported separately and are not in
  // the I4 denominator (matching Appendix A.9's projection).
  const excludedByPolicy = excludedSources.reduce((a, s) => a + (perSourceRaw.get(sourceKey(s)) ?? 0), 0);

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
    CREATE INDEX idx_q_source    ON questions(source, rowid);
    CREATE INDEX idx_q_source_subj ON questions(source, subject, session_eligible, rowid);
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

  // Assertion 4 is an off-by-one regression guard specific to H1's cop-index-
  // base ambiguity (D-027) — hard-gated for MedMCQA only. USMLE has no such
  // failure mode (its answer is a validated letter), so its histogram is
  // logged for visibility, never gated.
  const histMedmcqa = checkAnswerHistogram(sourceAcc.medmcqa.answerCounts, HISTOGRAM_LOWER, HISTOGRAM_UPPER);
  log(`     medmcqa histogram: ${histMedmcqa.shares.map((s, i) => `${'ABCD'[i]}=${(s * 100).toFixed(2)}%`).join('  ')}`);
  if (!histMedmcqa.ok) fail(`Assertion 4 FAILED (medmcqa): ${histMedmcqa.message}`);
  log('  4. answer-index distribution within 10–40% band (medmcqa) . PASS');

  const histUsmle = checkAnswerHistogram(sourceAcc.usmle.answerCounts, HISTOGRAM_LOWER, HISTOGRAM_UPPER);
  log(
    `     usmle histogram (logged only — no H1-equivalent hazard exists): ` +
      `${histUsmle.shares.map((s, i) => `${'ABCD'[i]}=${(s * 100).toFixed(2)}%`).join('  ')}` +
      (histUsmle.ok ? '' : `  [${histUsmle.message}]`)
  );

  const answerKeyHash = computeAnswerKeyHash(answerKeyEntries);
  if (answerKeyHash.length !== 64) fail('Assertion 5 FAILED: answerKeyHash is not a 64-char sha256');
  log(`  5. answerKeyHash written (${answerKeyHash.slice(0, 16)}…) ....... PASS`);

  // I4 — rejection-rate gate, evaluated per source (D-027): a source-specific
  // ingestion bug could clear a blended global rate while quietly failing
  // within that source alone.
  const rejectionRate = answerableRawCount === 0 ? 0 : (answerableRawCount - accepted) / answerableRawCount;
  log(`     blended rejection rate: ${(rejectionRate * 100).toFixed(4)}% (threshold ${MAX_REJECTION_RATE * 100}%, logged only)`);
  for (const s of SOURCES) {
    const acc = sourceAcc[s];
    const rate = acc.answerableRaw === 0 ? 0 : (acc.answerableRaw - acc.accepted) / acc.answerableRaw;
    log(`     ${s} rejection rate: ${(rate * 100).toFixed(4)}% over ${num(acc.answerableRaw)} records`);
    if (acc.answerableRaw > 0 && rate > MAX_REJECTION_RATE) {
      fail(
        `I4 (${s}): rejection rate ${(rate * 100).toFixed(2)}% exceeds ${MAX_REJECTION_RATE * 100}%.\n` +
          'This demands human review — see data/build/validation-report.json.'
      );
    }
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
  const sourceRows = db
    .prepare('SELECT source AS name, COUNT(*) AS count FROM questions GROUP BY source ORDER BY count DESC')
    .all() as { name: QuestionSource; count: number }[];

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
    sources: sourceRows,
    total: accepted,
  };
  fs.writeFileSync(path.join(BUILD_DIR, 'facets.json'), JSON.stringify(facets, null, 2));

  const sourceFiles = await Promise.all(
    discovered.map(async ({ source, file }) => ({
      file: `${source}/${path.basename(file)}`,
      bytes: fs.statSync(file).size,
      sha256: await sha256File(file),
    }))
  );

  const sourceManifest: Record<QuestionSource, SourceManifestEntry> = {
    medmcqa: {
      counts: {
        raw: rawBySource.medmcqa,
        accepted: sourceAcc.medmcqa.accepted,
        rejected: sourceAcc.medmcqa.answerableRaw - sourceAcc.medmcqa.accepted,
        duplicates: dupStatsBySource.medmcqa.redundant,
        conflictingAnswerGroups: dupStatsBySource.medmcqa.conflictingGroups,
        sessionEligible: sourceAcc.medmcqa.sessionEligible,
      },
      answerIndexHistogram: sourceAcc.medmcqa.answerCounts,
      copIndexBase,
      copDiagnostics: { rangeMin: copMin, rangeMax: copMax, markerComparable, markerAgree1, markerAgree0 },
    },
    usmle: {
      counts: {
        raw: rawBySource.usmle,
        accepted: sourceAcc.usmle.accepted,
        rejected: sourceAcc.usmle.answerableRaw - sourceAcc.usmle.accepted,
        duplicates: dupStatsBySource.usmle.redundant,
        conflictingAnswerGroups: dupStatsBySource.usmle.conflictingGroups,
        sessionEligible: sourceAcc.usmle.sessionEligible,
      },
      answerIndexHistogram: sourceAcc.usmle.answerCounts,
      copIndexBase: null,
      copDiagnostics: null,
    },
  };

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
      duplicates: dupStatsBySource.medmcqa.redundant + dupStatsBySource.usmle.redundant,
      conflictingAnswerGroups: dupStatsBySource.medmcqa.conflictingGroups + dupStatsBySource.usmle.conflictingGroups,
      sessionEligible: sessionEligibleCount,
    },
    answerIndexHistogram: answerCounts,
    answerKeyHash,
    sources: sourceManifest,
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
            name: sourceKey(s),
            records: perSourceRaw.get(sourceKey(s)) ?? 0,
            reason: 'H2 — ground truth withheld upstream; source carries no answer field',
          })),
        },
        rejectionsByCode: Object.fromEntries([...rejectionCounts.entries()].sort((a, b) => b[1] - a[1])),
        flagsByCode: Object.fromEntries([...flagCounts.entries()].sort((a, b) => b[1] - a[1])),
        duplicatesBySource: dupStatsBySource,
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
      `accepted           ${num(accepted)}  (medmcqa ${num(sourceAcc.medmcqa.accepted)} / usmle ${num(sourceAcc.usmle.accepted)})`,
      `rejected           ${num(answerableRawCount - accepted)}  (${(rejectionRate * 100).toFixed(4)}%)`,
      `excluded (H2)      ${num(excludedByPolicy)}`,
      `duplicates tagged  medmcqa ${num(dupStatsBySource.medmcqa.redundant)} / usmle ${num(dupStatsBySource.usmle.redundant)}`,
      `H9 conflicts       medmcqa ${num(dupStatsBySource.medmcqa.conflictingGroups)}g / usmle ${num(dupStatsBySource.usmle.conflictingGroups)}g`,
      `session-eligible   ${num(sessionEligibleCount)}`,
      `copIndexBase       ${copIndexBase}  (medmcqa only)`,
      `answerKeyHash      ${answerKeyHash}`,
    ])
  );
  log();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
