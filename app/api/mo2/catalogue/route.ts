import { readCatalogue, readCatalogueIndex } from '@/lib/mo2/server';
import { KIND_TO_CATALOGUE } from '@/lib/mo2/types';

/**
 * GET /api/mo2/catalogue            — index: which kinds exist and how many
 * GET /api/mo2/catalogue?kind=eyes  — that category's full entry list
 *
 * Static files under `public/assets/mo2/catalogue/` could serve the same bytes,
 * but going through the route means one origin for both reads and converted
 * assets, and it lets the server report `available: false` cleanly when the
 * archive is absent on another machine.
 */

export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind');

  if (!kind) {
    const index = await readCatalogueIndex();
    return Response.json(index, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  if (!KIND_TO_CATALOGUE[kind]) {
    return Response.json({ ok: false, error: `unknown kind: ${kind}` }, { status: 400 });
  }

  const entries = await readCatalogue(kind);
  return Response.json(
    { kind, count: entries.length, entries },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
