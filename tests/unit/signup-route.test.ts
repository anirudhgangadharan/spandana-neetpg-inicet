import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@/lib/db/userQueries', () => ({
  createUserWithPassword: mocks.create,
  EmailTakenError: class EmailTakenError extends Error {},
}));

import { POST } from '@/app/api/auth/signup/route';

function request(body: string, origin = 'https://example.org'): Request {
  return new Request('https://example.org/api/auth/signup', {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body,
  });
}

beforeEach(() => { vi.resetAllMocks(); });

describe('credentials signup route hardening', () => {
  it('requires same-origin, strict, bounded JSON', async () => {
    expect((await POST(request('{}', 'https://evil.example'))).status).toBe(403);
    expect((await POST(request(JSON.stringify({ email: 'a@example.org', password: 'long-pass', admin: true })))).status).toBe(400);
    expect((await POST(request(JSON.stringify({ email: `a@${'x'.repeat(5000)}.org`, password: 'long-pass' })))).status).toBe(413);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('normalizes valid input without exposing the password in the response', async () => {
    mocks.create.mockResolvedValue({ id: 'user-1', email: 'a@example.org', name: 'Ada', image: null });
    const response = await POST(request(JSON.stringify({ email: ' A@Example.org ', password: 'long-pass', name: ' Ada ' })));
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.create).toHaveBeenCalledWith('a@example.org', 'long-pass', 'Ada');
    expect(await response.text()).not.toContain('long-pass');
  });
});
