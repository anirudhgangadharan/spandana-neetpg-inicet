import type { QuestionFlag } from '@/types';

export interface FlagPresentation {
  readonly label: string;
  readonly description: string;
  /** `card` flags show on the card face; `detail` flags only in the provenance
   *  popover. Frequency decides: a flag on a third of the corpus cannot be a
   *  card-face chip without leaving the UI permanently alarmed (Appendix A.6). */
  readonly placement: 'card' | 'detail';
  readonly tone: 'warning' | 'neutral';
}

export const FLAG_PRESENTATION: Readonly<Record<QuestionFlag, FlagPresentation>> = Object.freeze({
  possible_text_corruption: {
    label: 'Possible text error',
    description:
      'This question matches a known defect in the source dataset where the letters "rt" were dropped from words (for example "artery" appearing as "aery"). The text is shown exactly as published — it is deliberately not auto-corrected, because silently rewriting medical terms is more dangerous than showing them broken.',
    placement: 'card',
    tone: 'warning',
  },
  conflicting_answer_variant: {
    label: 'Disputed answer',
    description:
      'The same question appears elsewhere in the dataset with a different answer marked correct. At least one of the two is wrong, and we cannot tell which from the data alone. Treat this item with caution and verify against a textbook.',
    placement: 'card',
    tone: 'warning',
  },
  two_distinct_options: {
    label: 'Only 2 distinct options',
    description: 'Two of the four options in the source record are identical.',
    placement: 'card',
    tone: 'warning',
  },
  three_distinct_options: {
    label: 'Only 3 distinct options',
    description: 'Two of the four options in the source record are identical.',
    placement: 'detail',
    tone: 'warning',
  },
  markup_stripped: {
    label: 'Formatting removed',
    description:
      'The source record contained stray HTML fragments, which were removed during import. The wording is unchanged.',
    placement: 'detail',
    tone: 'neutral',
  },
  multi_choice_type: {
    label: 'Labelled "multi"',
    description:
      'The dataset labels this question as multiple-answer, but it carries exactly one correct answer — a known upstream labelling inconsistency affecting about a third of the corpus. It is treated, and scored, as single-answer.',
    placement: 'detail',
    tone: 'neutral',
  },
  no_explanation: {
    label: 'No explanation',
    description: 'The source record has no expert explanation. Around one question in eight does not.',
    placement: 'detail',
    tone: 'neutral',
  },
  no_topic: {
    label: 'No topic',
    description: 'The source record has no topic label. Over half the corpus does not.',
    placement: 'detail',
    tone: 'neutral',
  },
});

export function flagsForCard(flags: readonly QuestionFlag[]): QuestionFlag[] {
  return flags.filter((f) => FLAG_PRESENTATION[f].placement === 'card');
}

export function flagsForDetail(flags: readonly QuestionFlag[]): QuestionFlag[] {
  return flags.filter((f) => FLAG_PRESENTATION[f].placement === 'detail');
}
