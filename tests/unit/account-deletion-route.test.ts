import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ actor: vi.fn(), remove: vi.fn() }));
vi.mock('@/lib/auth/roles', () => ({ getCurrentActor: mocks.actor }));
vi.mock('@/lib/db/accountDeletion', () => ({ deleteAccount: mocks.remove }));

import { DELETE } from '@/app/api/me/account/route';

function request(body: string, origin = 'https://example.org', contentType = 'application/json'): Request {
  return new Request('https://example.org/api/me/account', {
    method: 'DELETE', headers: { origin, 'content-type': contentType }, body,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.actor.mockResolvedValue({ userId: 'user-1', email: 'person@example.org', role: 'student' });
});

describe('account deletion route', () => {
  it('requires an authenticated same-origin JSON request', async () => {
    mocks.actor.mockResolvedValue(null);
    expect((await DELETE(request('{}'))).status).toBe(401);
    mocks.actor.mockResolvedValue({ userId: 'user-1', email: 'person@example.org', role: 'student' });
    expect((await DELETE(request('{}', 'https://evil.example'))).status).toBe(403);
    expect((await DELETE(request('{}', 'https://example.org', 'text/plain'))).status).toBe(415);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('strictly validates confirmation and passes only the signed-in user ID', async () => {
    expect((await DELETE(request(JSON.stringify({ email: 'person@example.org', extra: true })))).status).toBe(400);
    mocks.remove.mockResolvedValue({ deleted: false, ownedModulesDeleted: 0 });
    expect((await DELETE(request(JSON.stringify({ email: 'wrong@example.org' })))).status).toBe(400);
    mocks.remove.mockResolvedValue({ deleted: true, ownedModulesDeleted: 2 });
    const response = await DELETE(request(JSON.stringify({ email: 'person@example.org' })));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.remove).toHaveBeenLastCalledWith('user-1', 'person@example.org');
  });
});
