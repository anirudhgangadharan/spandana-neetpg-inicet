import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/roles';
import { facultyNoStore, facultyRouteError, facultyUuid } from '@/lib/api/facultyModuleRoutes';
import { ModuleInputError } from '@/lib/faculty/moduleInput';
import { getFacets } from '@/lib/db/queries';
import { getOwnedModule } from '@/lib/db/facultyModules';
import { listFacultyCandidates, type FacultyCandidateFilter } from '@/lib/db/facultyQuestions';
import type { QuestionFlag } from '@/types';

function boundedText(params: URLSearchParams, key: string, max: number): string | undefined {
  const value = params.get(key)?.trim();
  if (!value) return undefined;
  if (value.length > max) throw new ModuleInputError(`${key} is too long.`);
  return value;
}

function parseFilter(params: URLSearchParams): FacultyCandidateFilter {
  const source = boundedText(params, 'source', 20);
  if (source && source !== 'medmcqa' && source !== 'usmle') throw new ModuleInputError('Invalid source.');
  const validSource = source === 'medmcqa' || source === 'usmle' ? source : undefined;
  const flag = boundedText(params, 'flag', 80);
  const allowedFlags = getFacets().flags.map((entry) => entry.name);
  if (flag && !allowedFlags.some((name) => name === flag)) throw new ModuleInputError('Invalid flag.');
  const moduleId = boundedText(params, 'moduleId', 36) ?? null;
  if (moduleId !== null && !facultyUuid.test(moduleId)) throw new ModuleInputError('Invalid module ID.');
  const cursorText = params.get('cursor');
  const cursor = cursorText === null ? null : Number(cursorText);
  if (cursor !== null && (!/^\d+$/.test(cursorText!) || !Number.isSafeInteger(cursor) || cursor < 0)) {
    throw new ModuleInputError('Invalid cursor.');
  }
  const limitText = params.get('limit') ?? '25';
  const limit = Number(limitText);
  if (!/^\d+$/.test(limitText) || !Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new ModuleInputError('Limit must be 1–50.');
  }
  const subject = boundedText(params, 'subject', 200);
  const topic = boundedText(params, 'topic', 200);
  return {
    ...(validSource ? { source: validSource } : {}),
    ...(subject ? { subject } : {}),
    ...(topic ? { topic } : {}),
    ...(flag ? { flag: flag as QuestionFlag } : {}),
    search: boundedText(params, 'q', 120) ?? '',
    includeExcluded: params.get('includeExcluded') === '1',
    onlyUnused: params.get('onlyUnused') !== '0',
    moduleId,
    cursor,
    limit,
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  const actor = await requireRole('faculty');
  if (!actor) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: facultyNoStore });
  try {
    const filter = parseFilter(new URL(request.url).searchParams);
    if (filter.moduleId && !(await getOwnedModule(actor.userId, filter.moduleId))) {
      return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: facultyNoStore });
    }
    return NextResponse.json(await listFacultyCandidates(filter), { headers: facultyNoStore });
  } catch (error) {
    return facultyRouteError(error);
  }
}
