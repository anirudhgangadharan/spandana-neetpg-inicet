export const sharedAnalyticsHeaders = {
  'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow',
};
export const unavailableAnalyticsMessage = 'This analytics link is unavailable. Ask the module creator for a new link.';
export function parseAnalyticsQuery(params: URLSearchParams): { page: number; search: string } | null {
  const page = Number(params.get('page') ?? '1');
  const search = (params.get('q') ?? '').trim();
  return Number.isSafeInteger(page) && page >= 1 && page <= 10000 && search.length <= 120 ? { page, search } : null;
}
