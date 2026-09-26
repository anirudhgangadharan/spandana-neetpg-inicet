import { isAnswerIndex } from '@/lib/core/answer-index';

export class StudentModuleInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StudentModuleInputError';
  }
}

export const moduleUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseResponseSave(body: unknown): {
  readonly position: number;
  readonly selectedIndex: 0 | 1 | 2 | 3 | null;
  readonly expectedRevision: number;
} {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new StudentModuleInputError('Invalid answer request.');
  }
  const value = body as Record<string, unknown>;
  const allowed = new Set(['position', 'selectedIndex', 'expectedRevision']);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new StudentModuleInputError('Unexpected answer request field.');
  }
  if (!Number.isInteger(value['position']) || (value['position'] as number) < 1 || (value['position'] as number) > 200) {
    throw new StudentModuleInputError('Question position must be 1–200.');
  }
  if (value['selectedIndex'] !== null && !isAnswerIndex(value['selectedIndex'])) {
    throw new StudentModuleInputError('Choose A, B, C, D, or clear the answer.');
  }
  if (!Number.isSafeInteger(value['expectedRevision']) || (value['expectedRevision'] as number) < 0) {
    throw new StudentModuleInputError('Invalid answer revision.');
  }
  return {
    position: value['position'] as number,
    selectedIndex: value['selectedIndex'] as 0 | 1 | 2 | 3 | null,
    expectedRevision: value['expectedRevision'] as number,
  };
}

export function parseActivity(body: unknown): { readonly position: number | null } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new StudentModuleInputError('Invalid activity request.');
  }
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== 'position')) {
    throw new StudentModuleInputError('Unexpected activity request field.');
  }
  const position = value['position'];
  if (position !== null && (!Number.isInteger(position) || (position as number) < 1 || (position as number) > 200)) {
    throw new StudentModuleInputError('Activity position must be 1–200 or null.');
  }
  return { position: position as number | null };
}
