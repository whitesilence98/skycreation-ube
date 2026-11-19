import { ASSET_SOURCE } from '@/lib/mo2/assetSource';
import {
  ERROR_CACHE_CONTROL,
  ifNoneMatchMatches,
  notModifiedResponse,
  revalidateHeaders,
  responseEtag,
} from '@/lib/mo2/httpCache';
import { readManifest } from '@/lib/mo2/server';

export async function GET(request: Request) {
  try {
    // `readManifest` re-reads the file and rejects a document from another
    // source every time, so the bytes hashed here are the bytes on disk now.
    const doc = await readManifest();
    const body = JSON.stringify(doc);
    const etag = responseEtag('manifest', body);
    if (ifNoneMatchMatches(request, etag)) return notModifiedResponse(etag);
    return new Response(body, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        ...revalidateHeaders(etag),
      },
    });
  } catch {
    return Response.json(
      {
        available: false, source: ASSET_SOURCE.label, sourceId: ASSET_SOURCE.id,
        sourceLayout: ASSET_SOURCE.layout, sourceKey: ASSET_SOURCE.key,
        error: 'Active assets unavailable. Run npm run sync:assets and npm run sync:index.',
      },
      { status: 503, headers: { 'Cache-Control': ERROR_CACHE_CONTROL } },
    );
  }
}
