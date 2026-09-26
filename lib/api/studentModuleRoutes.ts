import { NextResponse } from 'next/server';
import { StudentAttemptError } from '@/lib/db/moduleAttempts';
import { StudentModuleInputError } from '@/lib/student/moduleInput';

export const studentNoStore = { 'Cache-Control': 'no-store' };

export async function studentJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new StudentModuleInputError('A small JSON body is required.');
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 2048) {
      await reader.cancel();
      throw new StudentModuleInputError('Answer request is too large.');
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new StudentModuleInputError('Invalid JSON body.');
  }
}

export function studentRouteError(error: unknown): NextResponse {
  if (error instanceof StudentModuleInputError) {
    return NextResponse.json({ message: error.message }, { status: 400, headers: studentNoStore });
  }
  if (error instanceof StudentAttemptError) {
    return NextResponse.json({ message: error.message }, { status: error.status, headers: studentNoStore });
  }
  throw error;
}
