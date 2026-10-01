import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ role: vi.fn(), status: vi.fn(), change: vi.fn(), shared: vi.fn() }));
vi.mock('@/lib/auth/roles', () => ({ requireRole: mocks.role }));
vi.mock('@/lib/db/moduleAnalyticsShares', () => ({ getAnalyticsShareStatus: mocks.status, changeAnalyticsShare: mocks.change, getSharedModuleAnalytics: mocks.shared }));
import { GET, POST, DELETE } from '@/app/api/faculty/modules/[id]/analytics-share/route';
import { GET as read } from '@/app/api/shared/module-analytics/[token]/route';
const id = 'b558908a-95c3-40e7-af58-3bf8ff5ea4ab';
const context = { params: Promise.resolve({ id }) };
const tokenContext = { params: Promise.resolve({ token: 'token' }) };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.role.mockResolvedValue({ userId: 'owner', role: 'faculty' });
  mocks.status.mockResolvedValue({ enabled: false, createdAt: null });
  mocks.change.mockResolvedValue({ token: 'new-token', status: { enabled: true, createdAt: 'now' } });
  mocks.shared.mockResolvedValue({ module: { title: 'Test' } });
});
describe('analytics sharing route boundaries', () => {
  it('requires same origin and ownership for management', async () => {
    expect((await POST(new Request('https://app.test/api', { method: 'POST', headers: { Origin: 'https://evil.test' } }), context)).status).toBe(403);
    expect(mocks.change).not.toHaveBeenCalled();
    mocks.role.mockResolvedValue(null);
    expect((await GET(new Request('https://app.test/api'), context)).status).toBe(404);
    expect(mocks.status).not.toHaveBeenCalled();
  });
  it('returns a new path once and revokes idempotently without disclosing secrets in status', async () => {
    const response = await POST(new Request('https://app.test/api', { method: 'POST', headers: { Origin: 'https://app.test' } }), context);
    expect(await response.json()).toMatchObject({ path: '/shared/module-analytics/new-token' });
    expect(mocks.change).toHaveBeenCalledWith('owner', id, true);
    expect(await (await GET(new Request('https://app.test/api'), context)).json()).toEqual({ status: { enabled: false, createdAt: null } });
    await DELETE(new Request('https://app.test/api', { method: 'DELETE', headers: { Origin: 'https://app.test' } }), context);
    expect(mocks.change).toHaveBeenCalledWith('owner', id, false);
  });
  it('reads without roles, enforces bounds, and sanitizes failures', async () => {
    const response = await read(new Request('https://app.test/api?page=2&q=Ada'), tokenContext);
    expect(response.status).toBe(200);
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.role).not.toHaveBeenCalled();
    expect(mocks.shared).toHaveBeenCalledWith('token', 2, 'Ada');
    for (const query of ['page=0', 'page=10001', 'page=1.5', `q=${'a'.repeat(121)}`]) {
      expect((await read(new Request(`https://app.test/api?${query}`), tokenContext)).status).toBe(400);
    }
    mocks.shared.mockResolvedValue(null);
    expect((await read(new Request('https://app.test/api'), tokenContext)).status).toBe(404);
    mocks.shared.mockRejectedValue(new Error('secret-token database connection'));
    const failed = await read(new Request('https://app.test/api'), tokenContext);
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain('secret-token');
  });
});
