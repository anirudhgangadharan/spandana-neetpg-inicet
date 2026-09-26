import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModuleBuilder } from '@/app/faculty/modules/[id]/ModuleBuilder';
import type { FacultyModuleDetail } from '@/lib/db/facultyModules';
import type { Facets } from '@/lib/db/queries';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const facets: Facets = {
  subjects: [], topicsBySubject: {}, flags: [], sources: [], total: 0, sessionEligible: 0,
};

const draft: FacultyModuleDetail = {
  id: '7399edc6-4c3e-4186-af4c-1bfd3e51c5bc', title: 'Practice module', status: 'draft',
  createdAt: new Date().toISOString(), questionCount: 0, openedCount: 0, startedCount: 0,
  submittedCount: 0, expiredCount: 0, description: null, instructions: null,
  opensAt: null, closesAt: null, durationSeconds: null, maxAttempts: 1,
  correctPoints: 4, wrongPoints: -1, blankPoints: 0, allowReview: false,
  shareToken: '49e6856c-5cc8-44d3-a055-736794c03711', revision: 0,
  publishedAt: null, selectedQuestions: [],
};

describe('faculty builder initial experience', () => {
  it('defaults to global unused-only, score-only, and blocks incomplete publication', () => {
    const html = renderToStaticMarkup(<ModuleBuilder initialModule={draft} facets={facets} />);
    expect(html).toMatch(/checked=""[^>]*\/> Only questions not used in any professor/);
    expect(html).toContain('Default is score only.');
    expect(html).toMatch(/disabled=""[^>]*>Publish module<\/button>/);
    expect(html).toContain('Save a valid time window and select at least one question first.');
    expect(html).toContain('Search question text');
  });

  it('enables publication for a saved, complete draft', () => {
    const html = renderToStaticMarkup(<ModuleBuilder initialModule={{
      ...draft, questionCount: 1, opensAt: new Date(Date.now() - 60_000).toISOString(),
      closesAt: new Date(Date.now() + 60_000).toISOString(), durationSeconds: 60,
    }} facets={facets} />);
    expect(html).toMatch(/>Publish module<\/button>/);
    expect(html).not.toMatch(/disabled=""[^>]*>Publish module<\/button>/);
  });
});
