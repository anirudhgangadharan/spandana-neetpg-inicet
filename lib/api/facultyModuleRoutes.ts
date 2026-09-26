import { NextResponse } from 'next/server';
import { CorpusUnavailableError } from '@/lib/db/client';
import { FacultyModuleError } from '@/lib/db/facultyModuleBuilder';
import { ModuleInputError } from '@/lib/faculty/moduleInput';
import { JsonBodyError, readBoundedJson } from '@/lib/api/jsonBody';

export const facultyNoStore = { 'Cache-Control': 'no-store' };
export const facultyUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function facultyJson(request: Request): Promise<unknown> {
  try {
    return await readBoundedJson(request, 32_768);
  } catch (error) {
    if (error instanceof JsonBodyError) throw new ModuleInputError(error.message);
    throw new ModuleInputError('Invalid JSON body.');
  }
}

export function facultyRouteError(error: unknown): NextResponse {
  if (error instanceof ModuleInputError) {
    return NextResponse.json({ message: error.message }, { status: 400, headers: facultyNoStore });
  }
  if (error instanceof FacultyModuleError) {
    return NextResponse.json({ message: error.message }, { status: error.status, headers: facultyNoStore });
  }
  if (error instanceof CorpusUnavailableError) {
    return NextResponse.json({ message: 'Question bank unavailable. Try again later.' }, { status: 503, headers: facultyNoStore });
  }
  throw error;
}
