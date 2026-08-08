/**
 * Print the derived H4 corruption lexicon for human review, without running a
 * full ETL. Appendix A.7 asks for a dictionary check rather than a hardcoded
 * list; an auto-derived dictionary that nobody reads is not a dictionary check,
 * so this exists to make the review cheap enough to actually do.
 *
 * Run: pnpm tsx scripts/etl/review-lexicon.ts [minCorruptFreq]
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCorruptionLexicon, countTokensInto } from '@/lib/parser/corruption';
import { toPlainText } from '@/lib/utils/sanitise';
import { detectFormat, discoverSources, streamRecords } from './read';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const minCorruptFreq = Number.parseInt(process.argv[2] ?? '3', 10);

async function main(): Promise<void> {
  const counts = new Map<string, number>();
  // H4's lexicon is MedMCQA-only (D-D) — that text-loss defect is specific to
  // MedMCQA's provenance pipeline, so USMLE files are skipped here too.
  const medmcqaSources = discoverSources(path.join(ROOT, 'data', 'raw')).filter((d) => d.source === 'medmcqa');
  for (const { file } of medmcqaSources) {
    const format = await detectFormat(file);
    for await (const item of streamRecords(file, format)) {
      if (!item.ok) continue;
      const r = item.rec as Record<string, unknown>;
      for (const k of ['question', 'opa', 'opb', 'opc', 'opd', 'exp']) {
        countTokensInto(counts, toPlainText(r[k] as string));
      }
    }
    console.error(`  scanned ${path.basename(file)}`);
  }

  const lex = buildCorruptionLexicon(counts, { minCorruptFreq });
  console.log(`\n${lex.length} pairs (minCorruptFreq=${minCorruptFreq}, ${counts.size} distinct tokens)\n`);
  console.log('corrupted'.padEnd(20) + 'intact'.padEnd(22) + 'corruptFreq'.padStart(12) + 'intactFreq'.padStart(12));
  for (const e of lex) {
    console.log(
      e.corrupted.padEnd(20) +
        e.intact.padEnd(22) +
        String(e.corruptedFreq).padStart(12) +
        String(e.intactFreq).padStart(12)
    );
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
