/** GET /api/facets — subject/topic/flag counts. Cached; the corpus is read-only. */

import { ok, withCorpus } from '@/lib/api/respond';
import { getFacets } from '@/lib/db/queries';

export function GET(): ReturnType<typeof withCorpus> {
  return withCorpus(() => ok(getFacets()));
}
