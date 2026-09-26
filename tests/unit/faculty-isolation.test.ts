import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requireRole: vi.fn(), getOwnedModuleDetail: vi.fn(), listOwnedModules: vi.fn() }));
vi.mock('@/lib/auth/roles', () => ({ requireRole: mocks.requireRole }));
vi.mock('@/lib/db/facultyModules', () => ({
  getOwnedModuleDetail: mocks.getOwnedModuleDetail,
  listOwnedModules: mocks.listOwnedModules,
}));

import { GET as getFacultyModule } from '@/app/api/faculty/modules/[id]/route';
import { GET as listFacultyModules } from '@/app/api/faculty/modules/route';

const moduleId = 'b558908a-95c3-40e7-af58-3bf8ff5ea4ab';
const request = new Request(`https://example.org/api/faculty/modules/${moduleId}`);

beforeEach(() => vi.resetAllMocks());

describe('faculty module isolation', () => {
  it('does not query module content for a super admin or student', async () => {
    mocks.requireRole.mockResolvedValue(null);
    const response = await getFacultyModule(request, { params: Promise.resolve({ id: moduleId }) });
    expect(response.status).toBe(404);
    expect(mocks.getOwnedModuleDetail).not.toHaveBeenCalled();
    const listResponse = await listFacultyModules(new Request('https://example.org/api/faculty/modules'));
    expect(listResponse.status).toBe(403);
    expect(mocks.listOwnedModules).not.toHaveBeenCalled();
  });

  it('passes the authenticated faculty ID to an owner-scoped lookup', async () => {
    mocks.requireRole.mockResolvedValue({ userId: 'faculty-a', role: 'faculty' });
    mocks.getOwnedModuleDetail.mockResolvedValue(null);
    const response = await getFacultyModule(request, { params: Promise.resolve({ id: moduleId }) });
    expect(response.status).toBe(404);
    expect(mocks.getOwnedModuleDetail).toHaveBeenCalledWith('faculty-a', moduleId);
  });
});
