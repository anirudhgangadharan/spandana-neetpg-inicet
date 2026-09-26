export class ModuleInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModuleInputError';
  }
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ModuleInputError('Expected an object.');
  }
  return value as Record<string, unknown>;
}

export function parseTitle(value: unknown): string {
  if (typeof value !== 'string') throw new ModuleInputError('Title is required.');
  const title = value.trim();
  if (title.length < 1 || title.length > 180) throw new ModuleInputError('Title must be 1–180 characters.');
  return title;
}

function optionalText(value: unknown, label: string, max: number): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > max) throw new ModuleInputError(`${label} is too long or invalid.`);
  return value.trim() || null;
}

function optionalDate(value: unknown, label: string): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    throw new ModuleInputError(`${label} must be an ISO UTC date and time.`);
  }
  const millis = Date.parse(value);
  if (!Number.isFinite(millis) || new Date(millis).toISOString().slice(0, 19) !== value.slice(0, 19)) {
    throw new ModuleInputError(`${label} is invalid.`);
  }
  return new Date(millis).toISOString();
}

function int(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || typeof value !== 'number' || value < min || value > max) {
    throw new ModuleInputError(`${label} must be between ${min} and ${max}.`);
  }
  return value;
}

export function parseRevision(value: unknown): number {
  return int(value, 'Revision', 0, 2_147_483_647);
}

export interface DraftSettings {
  readonly title: string;
  readonly description: string | null;
  readonly instructions: string | null;
  readonly opensAt: string | null;
  readonly closesAt: string | null;
  readonly durationSeconds: number | null;
  readonly maxAttempts: number;
  readonly correctPoints: number;
  readonly wrongPoints: number;
  readonly blankPoints: number;
  readonly allowReview: boolean;
}

/** A full replacement, not a partial patch: omitted fields cannot silently
 * reset exam policy or bypass validation. */
export function parseDraftSettings(value: unknown): { settings: DraftSettings; revision: number } {
  const input = object(value);
  const opensAt = optionalDate(input['opensAt'], 'Opening time');
  const closesAt = optionalDate(input['closesAt'], 'Closing time');
  if (opensAt !== null && closesAt !== null && opensAt >= closesAt) {
    throw new ModuleInputError('Closing time must be after opening time.');
  }
  const durationSeconds = input['durationSeconds'] === null
    ? null : int(input['durationSeconds'], 'Duration in seconds', 60, 43_200);
  if (typeof input['allowReview'] !== 'boolean') throw new ModuleInputError('Review policy is invalid.');
  return {
    revision: parseRevision(input['revision']),
    settings: {
      title: parseTitle(input['title']),
      description: optionalText(input['description'], 'Description', 4_000),
      instructions: optionalText(input['instructions'], 'Instructions', 10_000),
      opensAt,
      closesAt,
      durationSeconds,
      maxAttempts: int(input['maxAttempts'], 'Maximum attempts', 1, 10),
      correctPoints: int(input['correctPoints'], 'Correct points', 0, 20),
      wrongPoints: int(input['wrongPoints'], 'Wrong points', -20, 0),
      blankPoints: int(input['blankPoints'], 'Blank points', -20, 20),
      allowReview: input['allowReview'],
    },
  };
}

export function parseSelection(value: unknown): {
  readonly ids: readonly string[];
  readonly revision: number;
  readonly allowReuse: boolean;
} {
  const input = object(value);
  const ids = input['ids'];
  if (!Array.isArray(ids) || ids.length > 200 || ids.some((id) => typeof id !== 'string' || id.length < 1 || id.length > 128)) {
    throw new ModuleInputError('Select at most 200 valid question IDs.');
  }
  if (new Set(ids).size !== ids.length) throw new ModuleInputError('A question cannot appear twice.');
  if (typeof input['allowReuse'] !== 'boolean') throw new ModuleInputError('Reuse confirmation is invalid.');
  return { ids: ids as string[], revision: parseRevision(input['revision']), allowReuse: input['allowReuse'] };
}

export function parseAction(value: unknown): {
  readonly action: 'publish' | 'unpublish' | 'republish' | 'archive';
  readonly revision: number;
  readonly acceptReuse: boolean;
} {
  const input = object(value);
  const action = input['action'];
  if (action !== 'publish' && action !== 'unpublish' && action !== 'republish' && action !== 'archive') {
    throw new ModuleInputError('Unknown module action.');
  }
  if (typeof input['acceptReuse'] !== 'boolean') throw new ModuleInputError('Reuse confirmation is invalid.');
  return { action, revision: parseRevision(input['revision']), acceptReuse: input['acceptReuse'] };
}
