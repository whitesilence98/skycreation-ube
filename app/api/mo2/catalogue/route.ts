import {
  ERROR_CACHE_CONTROL,
  ifNoneMatchMatches,
  notModifiedResponse,
  revalidateHeaders,
  responseEtag,
} from '@/lib/mo2/httpCache';
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
 *
 * Catalogue ids are path hashes, not content hashes, so nothing here is
 * `immutable`: every successful read is revalidated against a fresh disk read
 * via a `private` ETag, and a 304 is only issued once today's bytes match.
 */

function jsonResponse(
  request: Request,
  payload: unknown,
  identity: string,
): Response {
  const body = JSON.stringify(payload);
  const etag = responseEtag('catalogue', body, identity);
  if (ifNoneMatchMatches(request, etag)) return notModifiedResponse(etag);
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...revalidateHeaders(etag),
    },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind');

  if (!kind) {
    const index = await readCatalogueIndex();
    return jsonResponse(request, index, 'index');
  }

  if (!KIND_TO_CATALOGUE[kind]) {
    return Response.json(
      { ok: false, error: `unknown kind: ${kind}` },
      { status: 400, headers: { 'Cache-Control': ERROR_CACHE_CONTROL } },
    );
  }

  const entries = await readCatalogue(kind);
  return jsonResponse(request, { kind, count: entries.length, entries }, `kind:${kind}`);
}
