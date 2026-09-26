import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(), create: vi.fn(), save: vi.fn(), remove: vi.fn(), replace: vi.fn(), status: vi.fn(), detail: vi.fn(),
}));
vi.mock('@/lib/auth/roles', () => ({ requireRole: mocks.requireRole }));
vi.mock('@/lib/db/facultyModules', () => ({ getOwnedModuleDetail: mocks.detail, listOwnedModules: vi.fn() }));
vi.mock('@/lib/db/facultyModuleBuilder', () => ({
  createFacultyDraft: mocks.create,
  saveFacultyDraftSettings: mocks.save,
  deleteFacultyModule: mocks.remove,
  replaceFacultyQuestions: mocks.replace,
  changeFacultyModuleStatus: mocks.status,
  FacultyModuleError: class FacultyModuleError extends Error {
    constructor(message: string, readonly status: number) { super(message); }
  },
}));

import { POST as createDraft } from '@/app/api/faculty/modules/route';
import { PATCH as editDraft } from '@/app/api/faculty/modules/[id]/route';
import { PUT as setQuestions } from '@/app/api/faculty/modules/[id]/questions/route';
import { POST as changeStatus } from '@/app/api/faculty/modules/[id]/status/route';
import { FacultyModuleError } from '@/lib/db/facultyModuleBuilder';

const id = 'b558908a-95c3-40e7-af58-3bf8ff5ea4ab';
const context = { params: Promise.resolve({ id }) };

function request(path: string, method: string, body: object, origin = 'https://example.org'): Request {
  return new Request(`https://example.org${path}`, {
    method,
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireRole.mockResolvedValue({ userId: 'faculty-a', role: 'faculty' });
  mocks.detail.mockResolvedValue({ id, title: 'Draft' });
});

describe('faculty builder route boundaries', () => {
  it('denies super admins before querying or changing module content', async () => {
    mocks.requireRole.mockResolvedValue(null);
    const response = await changeStatus(request(`/api/faculty/modules/${id}/status`, 'POST', {
      action: 'publish', revision: 0, acceptReuse: false,
    }), context);
    expect(response.status).toBe(404);
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.detail).not.toHaveBeenCalled();
  });

  it('rejects cross-origin draft creation and accepts the exact app origin', async () => {
    const blocked = await createDraft(request('/api/faculty/modules', 'POST', { title: 'Exam' }, 'https://evil.example'));
    expect(blocked.status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
    mocks.create.mockResolvedValue(id);
    const allowed = await createDraft(request('/api/faculty/modules', 'POST', { title: 'Exam' }));
    expect(allowed.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith('faculty-a', 'Exam');
  });

  it('rejects an oversized question set before writing', async () => {
    const response = await setQuestions(request(`/api/faculty/modules/${id}/questions`, 'PUT', {
      ids: Array.from({ length: 201 }, (_, index) => String(index)), revision: 0, allowReuse: false,
    }), context);
    expect(response.status).toBe(400);
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('passes the authenticated faculty ID to the writer and preserves a stale-edit conflict', async () => {
    mocks.save.mockRejectedValue(new FacultyModuleError('stale', 409));
    const response = await editDraft(request(`/api/faculty/modules/${id}`, 'PATCH', {
      revision: 0, title: 'Exam', description: null, instructions: null,
      opensAt: null, closesAt: null, durationSeconds: null,
      maxAttempts: 1, correctPoints: 4, wrongPoints: -1, blankPoints: 0, allowReview: false,
    }), context);
    expect(response.status).toBe(409);
    expect(mocks.save).toHaveBeenCalledWith('faculty-a', id, 0, expect.objectContaining({ title: 'Exam' }));
  });
});
