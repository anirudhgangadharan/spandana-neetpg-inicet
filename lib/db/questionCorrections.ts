import type { PoolClient } from '@neondatabase/serverless';
import type { Question } from '@/types';
import { correctedQuestion } from '@/lib/core/question';
import { getManifest } from './client';
import { sql } from './userClient';

export interface CorrectionRow {
  question_id: string;
  version: number;
  corpus_hash: string;
  stem: string;
  options: [string, string, string, string];
  answer_index: 0 | 1 | 2 | 3;
  explanation: string | null;
  reason: string;
  author_user_id: string | null;
  created_at: Date | string;
  reverted_from: number | null;
}

export async function latestCorrections(ids: readonly string[], client?: PoolClient): Promise<Map<string, CorrectionRow>> {
  if (ids.length === 0) return new Map();
  const query = `select distinct on (question_id) question_id, version, corpus_hash, stem,
      options, answer_index, explanation, reason, author_user_id, created_at, reverted_from
    from question_corrections where question_id = any($1::text[])
    order by question_id, version desc`;
  const rows = client ? (await client.query<CorrectionRow>(query, [ids])).rows
    : await sql.query(query, [ids]) as CorrectionRow[];
  const corpusHash = getManifest().answerKeyHash;
  for (const row of rows) {
    if (row.corpus_hash !== corpusHash) throw new Error('Question correction references a different corpus version.');
  }
  return new Map(rows.map((row) => [row.question_id, row]));
}

export async function effectiveQuestions(questions: readonly Question[], client?: PoolClient): Promise<{
  questions: Question[]; versions: Map<string, number>
}> {
  const rows = await latestCorrections(questions.map((question) => question.id), client);
  return {
    questions: questions.map((question) => {
      const row = rows.get(question.id);
      return row ? correctedQuestion(question, {
        stem: row.stem, options: row.options, answer: row.answer_index, explanation: row.explanation,
      }) : question;
    }),
    versions: new Map([...rows].map(([id, row]) => [id, row.version])),
  };
}
