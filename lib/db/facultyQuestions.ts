import type { Question, QuestionFlag, QuestionSource, Split } from '@/types';
import { listFacultyCandidateWindow } from './queries';
import { sql } from './userClient';

export interface FacultyCandidate {
  readonly id: string;
  readonly source: QuestionSource;
  readonly split: Split;
  readonly stem: string;
  readonly options: readonly [string, string, string, string];
  readonly subject: string;
  readonly topic: string | null;
  readonly flags: readonly QuestionFlag[];
  readonly eligible: boolean;
  readonly usedElsewhere: boolean;
}

export interface FacultyCandidateFilter {
  readonly source?: QuestionSource;
  readonly subject?: string;
  readonly topic?: string;
  readonly flag?: QuestionFlag;
  readonly search: string;
  readonly includeExcluded: boolean;
  readonly onlyUnused: boolean;
  readonly moduleId: string | null;
  readonly cursor: number | null;
  readonly limit: number;
}

export function candidateFromQuestion(question: Question, usedElsewhere: boolean): FacultyCandidate {
  return {
    id: question.id,
    source: question.source,
    split: question.split,
    stem: question.stem,
    options: question.options,
    subject: question.subject,
    topic: question.topic,
    flags: question.flags,
    eligible: question.sessionEligible,
    usedElsewhere,
  };
}

/** One indexed Postgres lookup for a bounded corpus page. The response never
 * includes the owning professor or module for another professor's question. */
export async function usedQuestionIds(ids: readonly string[], excludingModuleId: string | null): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = (await sql.query(
    `select distinct question_id from faculty_module_questions
     where question_id = any($1::text[])
       and ($2::uuid is null or module_id <> $2::uuid)`,
    [ids, excludingModuleId]
  )) as { question_id: string }[];
  return new Set(rows.map((row) => row.question_id));
}

/** Scan at most 500 corpus rows per request, even if every candidate is used.
 * The cursor advances only over examined rows, so no eligible hit is skipped. */
export async function listFacultyCandidates(filter: FacultyCandidateFilter): Promise<{
  readonly candidates: readonly FacultyCandidate[];
  readonly nextCursor: number | null;
  readonly scanned: number;
}> {
  const candidates: FacultyCandidate[] = [];
  let cursor = filter.cursor;
  let scanned = 0;
  while (scanned < 500 && candidates.length < filter.limit) {
    const page = listFacultyCandidateWindow({
      ...(filter.source ? { sources: [filter.source] } : {}),
      ...(filter.subject ? { subjects: [filter.subject] } : {}),
      ...(filter.topic ? { topics: [filter.topic] } : {}),
      ...(filter.flag ? { flags: [filter.flag] } : {}),
      sessionEligibleOnly: !filter.includeExcluded,
    }, filter.search, cursor, Math.min(100, 500 - scanned));
    if (page.items.length === 0) return { candidates, nextCursor: null, scanned };
    const used = await usedQuestionIds(page.items.map((item) => item.question.id), filter.moduleId);
    for (let index = 0; index < page.items.length; index += 1) {
      const item = page.items[index]!;
      cursor = item.cursor;
      scanned += 1;
      const usedElsewhere = used.has(item.question.id);
      if (!filter.onlyUnused || !usedElsewhere) {
        candidates.push(candidateFromQuestion(item.question, usedElsewhere));
      }
      if (candidates.length >= filter.limit) {
        return {
          candidates,
          nextCursor: index < page.items.length - 1 || page.hasMore ? cursor : null,
          scanned,
        };
      }
    }
    if (!page.hasMore) return { candidates, nextCursor: null, scanned };
  }
  return { candidates, nextCursor: cursor, scanned };
}
