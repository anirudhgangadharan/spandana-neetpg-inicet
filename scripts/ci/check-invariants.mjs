/**
 * CI enforcement of the invariants and anti-requirements (§13, §16).
 *
 * These are properties that must hold "in all code paths, in all states", and
 * the spec is explicit that they are "enforced by tests, not by convention".
 * A grep is a blunt instrument, but for the specific question "does this
 * identifier appear outside its permitted home?" it is exactly the right one.
 *
 * Run: pnpm lint:invariants
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SKIP_DIRS = new Set([
  'node_modules', '.next', '.git', 'coverage', 'data', 'reports',
  'playwright-report', 'test-results', 'dist', 'build', '.turbo',
]);
const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.claude') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (SOURCE_EXT.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');

/**
 * Blank out comments, preserving line numbering.
 *
 * Comments must not count as violations — a file is allowed to *discuss* the
 * invariants, and several deliberately do. No regex literal in this codebase
 * contains a `//` sequence, so the naive line-comment strip is safe here.
 */
function stripComments(text) {
  const blanked = text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));
  return blanked;
}

const files = walk(ROOT).map((f) => {
  const text = fs.readFileSync(f, 'utf8');
  return { path: rel(f), text, code: stripComments(text) };
});

const violations = [];
const checks = [];

function record(name, detail, offenders) {
  checks.push({ name, ok: offenders.length === 0, count: offenders.length });
  if (offenders.length > 0) violations.push({ name, detail, offenders });
}

/** Report every line of `file.code` (comments blanked) matching `re`. */
function linesMatching(file, re) {
  const out = [];
  const lines = file.code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (re.test(line)) out.push(`${file.path}:${i + 1}  ${line.trim().slice(0, 120)}`);
    re.lastIndex = 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// I1/I3 — `answerIndex` is confined to lib/core/ and types/
// ---------------------------------------------------------------------------
// Carve-out (DECISIONS.md D-012): `tests/` may name it, because T1 and T4 are
// SPECIFIED in terms of `q.answerIndex` — §12.1 requires asserting
// `isCorrect(q, i) === (i === q.answerIndex)`, which cannot be written without
// naming it. Nothing in the shipped application is exempt.
{
  const ALLOWED = [/^lib\/core\//, /^types\//, /^tests\//, /^scripts\/ci\/check-invariants\.mjs$/];
  // Match the ways the field can actually be READ in code — property access and
  // destructuring — rather than every textual occurrence. Build-log prose such
  // as "answerIndex = cop - 1" is not a use of the field and must not fail CI,
  // but `q.answerIndex` and `const { answerIndex } = q` must.
  const READS = [/\.\s*answerIndex\b/, /[{,]\s*answerIndex\s*[,:}]/];
  const offenders = [];
  for (const file of files) {
    if (ALLOWED.some((re) => re.test(file.path))) continue;
    for (const re of READS) offenders.push(...linesMatching(file, re));
  }
  record(
    'I1/I3: `answerIndex` confined to lib/core/ and types/',
    'Read the answer through lib/core (correctOptionPosition / correctOptionText / isCorrect) instead.',
    offenders
  );
}

// ---------------------------------------------------------------------------
// §13.6 — dangerouslySetInnerHTML is forbidden outright (D-006)
// ---------------------------------------------------------------------------
{
  const offenders = [];
  for (const file of files) {
    if (file.path === 'scripts/ci/check-invariants.mjs') continue;
    offenders.push(...linesMatching(file, /dangerouslySetInnerHTML/));
  }
  record(
    '§13.6: no dangerouslySetInnerHTML',
    'Dataset text is sanitised to plain text in the ETL and rendered via React interpolation.',
    offenders
  );
}

// ---------------------------------------------------------------------------
// §13.7 — Math.random() is forbidden in application code
// ---------------------------------------------------------------------------
{
  const ALLOWED = [/^tests\//, /^scripts\//];
  const offenders = [];
  for (const file of files) {
    if (ALLOWED.some((re) => re.test(file.path))) continue;
    offenders.push(...linesMatching(file, /Math\s*\.\s*random\s*\(/));
  }
  record(
    '§13.7: no Math.random() in application code',
    'Use the seeded PRNG in lib/utils/rng.ts so sessions are reproducible and resumable.',
    offenders
  );
}

// ---------------------------------------------------------------------------
// §13.12 — no `any` in lib/core/, lib/parser/, types/
// ---------------------------------------------------------------------------
{
  const GUARDED = [/^lib\/core\//, /^lib\/parser\//, /^types\//];
  const offenders = [];
  for (const file of files) {
    if (!GUARDED.some((re) => re.test(file.path))) continue;
    offenders.push(...linesMatching(file, /(:\s*any\b)|(\bas\s+any\b)|(<any>)|(\bany\[\])/));
  }
  record('§13.12: no `any` in lib/core, lib/parser, types', 'Use `unknown` and narrow it.', offenders);
}

// ---------------------------------------------------------------------------
// I3 — the persisted client store must contain no answer data
// ---------------------------------------------------------------------------
{
  const STORAGE = [/^lib\/storage\//, /^features\/import-export\//];
  const offenders = [];
  for (const file of files) {
    if (!STORAGE.some((re) => re.test(file.path))) continue;
    offenders.push(...linesMatching(file, /\b(answerIndex|answer_index|correctIndex|answerKey|\bcop\b)\b/));
  }
  record(
    'I3: no answer data in the persisted client store',
    'AttemptRecord stores the user selection and derived verdict only.',
    offenders
  );
}

// ---------------------------------------------------------------------------
// I2 / §16 — zero LLM dependencies anywhere in the graph
// ---------------------------------------------------------------------------
{
  const LLM_RE =
    /(^|\/)(openai|@anthropic-ai|anthropic|langchain|@langchain|llamaindex|cohere-ai|@google\/generative-ai|@google\/genai|@mistralai|replicate|ollama|@huggingface|gpt-\d|transformers)(\/|$)/i;
  const offenders = [];

  const lockPath = path.join(ROOT, 'pnpm-lock.yaml');
  if (!fs.existsSync(lockPath)) {
    offenders.push('pnpm-lock.yaml not found — cannot audit the dependency graph');
  } else {
    // Every resolved package in the graph appears as a `/name@version:` key.
    const lock = fs.readFileSync(lockPath, 'utf8');
    const seen = new Set();
    for (const m of lock.matchAll(/^\s{2}(\/?)((?:@[^/\s]+\/)?[^@\s/][^@\s]*)@[^:\s]+:/gm)) {
      const name = m[2];
      if (!seen.has(name) && LLM_RE.test(name)) {
        seen.add(name);
        offenders.push(`pnpm-lock.yaml: transitive dependency "${name}"`);
      }
    }
  }

  // Also catch a runtime call that bypasses a package, e.g. a raw fetch to an
  // inference endpoint.
  for (const file of files) {
    if (file.path === 'scripts/ci/check-invariants.mjs') continue;
    offenders.push(
      ...linesMatching(file, /api\.(openai|anthropic|cohere|mistral)\.com|generativelanguage\.googleapis\.com/i)
    );
  }

  record(
    'I2/§16: zero LLM packages or inference endpoints in the dependency graph',
    'The correctness path must contain no generative component of any kind.',
    offenders
  );
}

// ---------------------------------------------------------------------------
// §6 — lib/core stays pure: no React, no Zustand, no I/O, no async
// ---------------------------------------------------------------------------
{
  const offenders = [];
  for (const file of files) {
    if (!/^lib\/core\//.test(file.path)) continue;
    offenders.push(
      ...linesMatching(file, /from\s+['"](react|zustand|next\/|@?fs\b|node:fs|node:http|idb)/),
      ...linesMatching(file, /\basync\s+function\b|\bawait\b/)
    );
    // node:crypto is permitted in answer-key.ts alone: hashing performs no I/O
    // and is synchronous, and that module is never imported by the client.
    if (!file.path.endsWith('lib/core/answer-key.ts')) {
      offenders.push(...linesMatching(file, /from\s+['"]node:/));
    }
  }
  record('§6: lib/core is pure (no React, Zustand, I/O, or async)', 'Move impure code out of the trusted base.', offenders);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
console.log('\nInvariant checks\n');
for (const c of checks) {
  console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok ? '' : `  (${c.count} violation${c.count === 1 ? '' : 's'})`}`);
}

if (violations.length > 0) {
  console.error('\n──────────────────────────────────────────────────────────────');
  for (const v of violations) {
    console.error(`\nFAILED: ${v.name}`);
    console.error(`  ${v.detail}`);
    for (const o of v.offenders.slice(0, 25)) console.error(`    ${o}`);
    if (v.offenders.length > 25) console.error(`    …and ${v.offenders.length - 25} more`);
  }
  console.error('\n──────────────────────────────────────────────────────────────\n');
  process.exit(1);
}

console.log(`\nAll ${checks.length} invariant checks passed over ${files.length} source files.\n`);
