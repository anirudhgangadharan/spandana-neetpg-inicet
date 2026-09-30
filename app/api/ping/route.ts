import { NextResponse } from 'next/server';

// An active exam can be otherwise silent for longer than Render's idle timeout.
export function GET(): NextResponse {
  return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
