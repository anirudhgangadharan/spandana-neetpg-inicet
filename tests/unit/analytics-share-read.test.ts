import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), analytics: vi.fn() }));
vi.mock('@/lib/db/userClient', () => ({ sql: { query: mocks.query } }));
vi.mock('@/lib/db/facultyAnalytics', () => ({ getOwnedModuleAnalytics: mocks.analytics }));
import { getSharedModuleAnalytics, hashAnalyticsToken } from '@/lib/db/moduleAnalyticsShares';
beforeEach(() => vi.resetAllMocks());
it('rejects malformed tokens without a query and uses deterministic SHA-256 hashes', async () => {
  expect(await getSharedModuleAnalytics('test-link-uuid')).toBeNull();
  expect(mocks.query).not.toHaveBeenCalled();
  expect(hashAnalyticsToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
it('fails closed when a token is revoked during aggregation', async () => {
  mocks.query.mockResolvedValueOnce([{ module_id: 'module', owner_user_id: 'database-owner' }]).mockResolvedValueOnce([]);
  mocks.analytics.mockResolvedValue({ participants: { items: [] } });
  expect(await getSharedModuleAnalytics('a'.repeat(43), 2, 'Ada')).toBeNull();
  expect(mocks.analytics).toHaveBeenCalledWith('database-owner', 'module', 2, 'Ada');
});
