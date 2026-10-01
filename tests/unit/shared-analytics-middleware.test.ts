import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('next-auth', () => ({ default: () => ({ auth: (handler: unknown) => handler }) }));
import middleware from '@/middleware';
describe('public analytics middleware', () => {
  it('allows anonymous pages and APIs through the same bounded bucket with private headers', async () => {
    const call = middleware as unknown as (request: NextRequest) => Response;
    for (let count = 0; count < 60; count++) {
      const path = count % 2 ? '/api/shared/module-analytics/invalid' : '/shared/module-analytics/invalid';
      const response = call(new NextRequest(`https://app.test${path}`, { headers: { 'x-real-ip': '192.0.2.42' } }));
      expect(response.status).toBe(200);
      expect(response.headers.get('location')).toBeNull();
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    const blocked = call(new NextRequest('https://app.test/shared/module-analytics/invalid', { headers: { 'x-real-ip': '192.0.2.42' } }));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBeTruthy();
    expect(await blocked.text()).not.toContain('invalid');
  });
});
