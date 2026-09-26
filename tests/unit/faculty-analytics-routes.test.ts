import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ role: vi.fn(), module: vi.fn(), overview: vi.fn() }));
vi.mock('@/lib/auth/roles', () => ({ requireRole: mocks.role }));
vi.mock('@/lib/db/facultyAnalytics', () => ({
  getOwnedModuleAnalytics: mocks.module, getFacultyOverview: mocks.overview,
}));

import { GET as moduleAnalytics } from '@/app/api/faculty/modules/[id]/analytics/route';
import { GET as overallAnalytics } from '@/app/api/faculty/analytics/route';

const id = 'b558908a-95c3-40e7-af58-3bf8ff5ea4ab';
const context = { params: Promise.resolve({ id }) };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.role.mockResolvedValue({ role: 'faculty', userId: 'faculty-a' });
  mocks.module.mockResolvedValue({ module: { id } });
  mocks.overview.mockResolvedValue({ modules: [] });
});

describe('faculty analytics route boundaries', () => {
  it('blocks non-faculty before any analytics query', async () => {
    mocks.role.mockResolvedValue(null);
    expect((await moduleAnalytics(new Request(`https://example.org/api/faculty/modules/${id}/analytics`), context)).status).toBe(404);
    expect((await overallAnalytics()).status).toBe(403);
    expect(mocks.module).not.toHaveBeenCalled();
    expect(mocks.overview).not.toHaveBeenCalled();
  });

  it('passes only the authenticated faculty owner and bounded query values', async () => {
    const response = await moduleAnalytics(new Request(
      `https://example.org/api/faculty/modules/${id}/analytics?page=2&q=Ada`
    ), context);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.module).toHaveBeenCalledWith('faculty-a', id, 2, 'Ada');
    await overallAnalytics();
    expect(mocks.overview).toHaveBeenCalledWith('faculty-a');
  });

  it('returns not found across the ownership boundary and rejects invalid pagination', async () => {
    mocks.module.mockResolvedValue(null);
    expect((await moduleAnalytics(new Request(`https://example.org/api/faculty/modules/${id}/analytics`), context)).status).toBe(404);
    expect((await moduleAnalytics(new Request(`https://example.org/api/faculty/modules/${id}/analytics?page=0`), context)).status).toBe(400);
  });
});
