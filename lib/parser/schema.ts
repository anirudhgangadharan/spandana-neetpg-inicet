/**
 * §5.1 Schema detection.
 *
 * Roles are inferred from STRUCTURAL signals — field type, presence rate, length
 * distribution, sibling correlation, integer range. Name priors may *boost* a
 * candidate but are never the sole basis, because §2.2's key table is explicitly
 * "a prior, not a fact".
 *
 * Returns the mapping plus a confidence report. Confidence below threshold must
 * abort the build with a human-readable diagnosis, never a guess (I4).
 */

export interface SchemaMapping {
  readonly id: string | null;
  readonly stem: string | null;
  readonly options: readonly string[];
  readonly answer: string | null;
  readonly explanation: string | null;
  readonly subject: string | null;
  readonly topic: string | null;
  readonly choiceType: string | null;
}

export interface FieldProfile {
  readonly presence: number;
  readonly stringRate: number;
  readonly intRate: number;
  readonly nullRate: number;
  readonly meanLen: number;
  readonly intMin: number | null;
  readonly intMax: number | null;
}

export interface SchemaDetection {
  readonly mapping: SchemaMapping;
  /** False when the source carries no answer field at all (H2 — the test split). */
  readonly answerable: boolean;
  readonly confidence: number;
  readonly reasons: readonly string[];
  readonly profile: Readonly<Record<string, FieldProfile>>;
}

/** Confidence at or below which the build must abort rather than guess. */
export const MIN_SCHEMA_CONFIDENCE = 0.8;

type Role = 'stem' | 'options' | 'answer' | 'explanation' | 'subject' | 'topic' | 'choiceType' | 'id';

/** Typed by `Role` rather than `string` so lookups need no defensive fallback. */
const NAME_PRIOR: Readonly<Record<Role, readonly string[]>> = Object.freeze({
  stem: ['question', 'stem', 'query', 'text'],
  options: ['opa', 'opb', 'opc', 'opd', 'option_a', 'option_b', 'option_c', 'option_d'],
  answer: ['cop', 'answer', 'correct', 'label', 'answer_idx', 'correct_option'],
  explanation: ['exp', 'explanation', 'rationale'],
  subject: ['subject_name', 'subject'],
  topic: ['topic_name', 'topic'],
  choiceType: ['choice_type', 'choicetype'],
  id: ['id', 'uuid', '_id', 'qid'],
});

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function detectSchema(sampleRecords: readonly unknown[]): SchemaDetection {
  const sample = sampleRecords.filter(isRecord);
  if (sample.length === 0) {
    return {
      mapping: { id: null, stem: null, options: [], answer: null, explanation: null, subject: null, topic: null, choiceType: null },
      answerable: false,
      confidence: 0,
      reasons: ['sample contained no object records'],
      profile: {},
    };
  }

  const keys = new Set<string>();
  for (const r of sample) for (const k of Object.keys(r)) keys.add(k);

  const profile: Record<string, FieldProfile> = {};
  for (const k of keys) {
    let present = 0, strings = 0, ints = 0, nulls = 0, lenSum = 0, lenN = 0;
    let min = Number.POSITIVE_INFINITY, max = Number.NEGATIVE_INFINITY;
    for (const r of sample) {
      if (!(k in r)) continue;
      present++;
      const v = r[k];
      if (v === null || v === undefined) { nulls++; continue; }
      if (typeof v === 'string') { strings++; lenSum += v.length; lenN++; }
      else if (typeof v === 'number' && Number.isInteger(v)) {
        ints++; min = Math.min(min, v); max = Math.max(max, v);
      }
    }
    // `present >= 1` always: `keys` is the union of the sampled records' own
    // keys, so every key here was seen on at least one record.
    profile[k] = {
      presence: present / sample.length,
      stringRate: strings / present,
      intRate: ints / present,
      nullRate: nulls / present,
      meanLen: lenN > 0 ? lenSum / lenN : 0,
      intMin: Number.isFinite(min) ? min : null,
      intMax: Number.isFinite(max) ? max : null,
    };
  }

  /** Every key in `keys` has a profile by construction, so no fallback is needed. */
  const p = (k: string): FieldProfile => profile[k] as FieldProfile;
  const nameBoost = (role: Role, key: string): number =>
    NAME_PRIOR[role].includes(key.toLowerCase()) ? 1 : 0;

  // --- stem: the longest consistently-present string field --------------------
  const stemCands = [...keys]
    .filter((k) => p(k).presence > 0.98 && p(k).stringRate > 0.98)
    .map((k) => ({ key: k, score: Math.log10(1 + p(k).meanLen) + 2 * nameBoost('stem', k) }))
    .sort((a, b) => b.score - a.score);

  // --- options -----------------------------------------------------------
  // Two signals, strongest first.
  //
  // (1) Enumeration shape. Four fields sharing a common prefix and
  //     distinguished by a one-character a/b/c/d or 1/2/3/4 suffix is an
  //     overwhelmingly strong structural signal, and it is a signal about the
  //     naming *pattern* rather than about specific names — it identifies
  //     `opa..opd`, `option_a..option_d`, `A..D` and `c1..c4` equally well.
  //
  // (2) Length correlation, as a fallback. The similarity metric must be
  //     SYMMETRIC: an earlier version divided by the candidate's own mean
  //     length, so a long field (the stem, or a short explanation) counted every
  //     short field as its sibling without the reverse holding, and outscored
  //     the real options. That misfires only when the explanation happens to be
  //     short, which is exactly the case a small fixture exhibits and a large
  //     corpus hides.
  const stemKey = stemCands[0]?.key ?? null;
  const optPool = [...keys].filter(
    (k) => k !== stemKey && p(k).presence > 0.98 && p(k).stringRate > 0.9 && p(k).meanLen < 120
  );

  const enumerationGroup = ((): string[] | null => {
    const byPrefix = new Map<string, string[]>();
    for (const k of optPool) {
      // `''.slice(-1)` is `''`, which fails the suffix test below, so an empty
      // key needs no special case.
      const suffix = k.slice(-1).toLowerCase();
      if (!/^[a-d1-4]$/.test(suffix)) continue;
      const prefix = k.slice(0, -1).toLowerCase();
      const bucket = byPrefix.get(prefix);
      if (bucket === undefined) byPrefix.set(prefix, [k]);
      else bucket.push(k);
    }
    for (const group of byPrefix.values()) {
      if (group.length !== 4) continue;
      const suffixes = group
        .map((k) => k.slice(-1).toLowerCase())
        .sort()
        .join('');
      if (suffixes === 'abcd' || suffixes === '1234') return [...group].sort();
    }
    return null;
  })();

  const similar = (a: string, b: string): boolean => {
    const la = p(a).meanLen;
    const lb = p(b).meanLen;
    return Math.abs(la - lb) / Math.max(la, lb, 1) < 0.6;
  };
  const optScored = optPool
    .map((k) => ({
      key: k,
      score: optPool.filter((o) => o !== k && similar(o, k)).length + 3 * nameBoost('options', k),
    }))
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));

  const options =
    enumerationGroup ?? optScored.slice(0, 4).map((o) => o.key).sort();

  // --- answer: the only small-integer field ranging over [0,3] or [1,4] -------
  const answerCands = [...keys]
    .filter((k) => p(k).intRate > 0.9 && p(k).intMin !== null)
    .map((k) => {
      const lo = p(k).intMin as number;
      const hi = p(k).intMax as number;
      const exact = (lo === 0 && hi === 3) || (lo === 1 && hi === 4);
      const plausible = lo >= 0 && hi <= 4 && hi - lo <= 4;
      return { key: k, score: (exact ? 5 : plausible ? 2 : 0) + 2 * nameBoost('answer', k) };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  const pickByName = (role: Role): string | null =>
    [...keys].find((k) => NAME_PRIOR[role].includes(k.toLowerCase())) ?? null;

  const mapping: SchemaMapping = {
    id: pickByName('id'),
    stem: stemCands[0]?.key ?? null,
    options,
    answer: answerCands[0]?.key ?? null,
    explanation: pickByName('explanation'),
    subject: pickByName('subject'),
    topic: pickByName('topic'),
    choiceType: pickByName('choiceType'),
  };

  // A source with NO answer field is not a low-confidence detection — it is a
  // confidently-detected unanswerable source (H2). Score the two apart, or the
  // test split would look like a parser failure rather than a known property.
  const answerable = mapping.answer !== null;

  const reasons: string[] = [];
  let confidence = 1;
  const drop = (amount: number, why: string): void => { confidence -= amount; reasons.push(why); };

  const s0 = stemCands[0];
  const s1 = stemCands[1];
  if (!s0) drop(0.5, 'no stem candidate: no consistently-present string field');
  else if (s1 && s0.score > 0 && s1.score / s0.score > 0.9)
    drop(0.15, `stem ambiguous: "${s0.key}" barely beats "${s1.key}"`);

  if (options.length !== 4) drop(0.5, `found ${options.length} option fields, expected 4`);
  else if (enumerationGroup === null) {
    // Only the weaker fallback signal was available, so report how close the
    // cut was. An unambiguous enumeration group needs no such caveat.
    reasons.push('option fields inferred from length correlation, not an a/b/c/d enumeration pattern');
    const o3 = optScored[3];
    const o4 = optScored[4];
    if (o3 && o4 && o4.score >= o3.score)
      drop(0.2, `option set ambiguous at the boundary: "${o3.key}" vs "${o4.key}"`);
  }

  const a0 = answerCands[0];
  const a1 = answerCands[1];
  if (answerable && a0 && a1 && a1.score === a0.score)
    drop(0.25, `answer field ambiguous: "${a0.key}" vs "${a1.key}" score equally`);
  if (!mapping.id) drop(0.1, 'no id field detected');
  if (!answerable) reasons.push('no answer field present → unanswerable source (H2); excluded from the corpus');

  return {
    mapping,
    answerable,
    confidence: Math.max(0, Number(confidence.toFixed(3))),
    reasons,
    profile,
  };
}
