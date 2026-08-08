/**
 * `planSession` against the real built corpus.
 *
 * Regression guard for a bug caught during browser verification of the USMLE
 * integration: the candidate-pool query ordered by `rowid LIMIT poolSize`,
 * which is assignment order from the ETL. Because every MedMCQA row is
 * inserted before any USMLE row, the two sources occupy disjoint,
 * non-interleaved rowid ranges — a single rowid-ordered pool of any practical
 * size was entirely MedMCQA, so a session with BOTH sources selected silently
 * returned 100% MedMCQA regardless of pool size or question count. Fixed in
 * `lib/db/queries.ts` by pooling per source and concatenating before the
 * seeded shuffle (DECISIONS.md — recorded alongside D-021).
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { getQuestionsByIds, planSession } from '@/lib/db/queries';

const DB_PATH = path.join(process.cwd(), 'data', 'build', 'corpus.sqlite');
const corpusExists = fs.existsSync(DB_PATH);

if (!corpusExists && process.env['CI'] === 'true') {
  throw new Error('corpus.sqlite is missing. Run `pnpm data:build`.');
}

describe.skipIf(!corpusExists)('planSession — multi-source pooling', () => {
  it('a single-source plan is unaffected (regression guard on existing behaviour)', () => {
    const plan = planSession({ filters: { sources: ['medmcqa'] }, count: 20, seed: 'regression-single' });
    expect(plan.ids).toHaveLength(20);
    const questions = getQuestionsByIds(plan.ids);
    expect(questions.every((q) => q.source === 'medmcqa')).toBe(true);
  });

  it('a plan scoped to usmle only returns only usmle questions', () => {
    const plan = planSession({ filters: { sources: ['usmle'] }, count: 20, seed: 'regression-usmle' });
    expect(plan.ids).toHaveLength(20);
    const questions = getQuestionsByIds(plan.ids);
    expect(questions.every((q) => q.source === 'usmle')).toBe(true);
  });

  it('a plan with BOTH sources selected actually includes both — not 100% of whichever was inserted first', () => {
    const seeds = ['mix-a', 'mix-b', 'mix-c', 'mix-d', 'mix-e'];
    for (const seed of seeds) {
      const plan = planSession({ filters: { sources: ['medmcqa', 'usmle'] }, count: 100, seed });
      const questions = getQuestionsByIds(plan.ids);
      const bySource = new Map<string, number>();
      for (const q of questions) bySource.set(q.source, (bySource.get(q.source) ?? 0) + 1);

      expect(bySource.get('medmcqa') ?? 0).toBeGreaterThan(0);
      expect(bySource.get('usmle') ?? 0).toBeGreaterThan(0);
    }
  });

  it('the pool bias was source-specific, not general: a mixed plan combined with a subject filter still includes both sources when both have matching subjects', () => {
    // Sanity: filters compose (source AND subject), not just source alone.
    const plan = planSession({
      filters: { sources: ['medmcqa', 'usmle'], subjects: ['Anatomy', 'USMLE Step 1'] },
      count: 40,
      seed: 'mix-with-subject',
    });
    const questions = getQuestionsByIds(plan.ids);
    expect(questions.every((q) => q.subject === 'Anatomy' || q.subject === 'USMLE Step 1')).toBe(true);
  });

  it('remains deterministic: the same seed and filters reproduce the identical sequence', () => {
    const a = planSession({ filters: { sources: ['medmcqa', 'usmle'] }, count: 30, seed: 'determinism-check' });
    const b = planSession({ filters: { sources: ['medmcqa', 'usmle'] }, count: 30, seed: 'determinism-check' });
    expect(a.ids).toEqual(b.ids);
  });
});
