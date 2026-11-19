import { ASSET_SOURCE } from '@/lib/mo2/assetSource';
import {
  ERROR_CACHE_CONTROL,
  ifNoneMatchMatches,
  notModifiedResponse,
  revalidateHeaders,
  responseEtag,
} from '@/lib/mo2/httpCache';
import { findEntry, companionGeometry, convert, readCatalogueIndex } from '@/lib/mo2/server';
import {
  CONVERT_MODES,
  KIND_TO_CATALOGUE,
  isMeshKind,
  type ConvertMode,
} from '@/lib/mo2/types';

/**
 * GET /api/mo2/convert?kind=skin&id=skin-8d44…&mode=albedo&role=albedo
 *
 * Every id resolves through the catalogue. The catalogue only ever records
 * paths the indexer walked, so an id that is not listed cannot name a file —
 * that is the traversal guard, and it runs before any filesystem call.
 *
 * Catalogue ids are path hashes, not content hashes: the same id can resolve
 * to different bytes after a source switch, a re-sync, or an upstream edit.
 * The response is therefore never `immutable`. Every successful body carries
 * an ETag over the bytes this request actually resolved (freshness-checked
 * cache or a fresh conversion), so a 304 is only issued after validation
 * passed and the current bytes were confirmed to match the client's copy.
 * `private` keeps a user's local mod content out of shared proxy caches.
 */

function bad(status: number, message: string, extra: Record<string, unknown> = {}) {
  return Response.json(
    { ok: false, error: message, ...extra },
    { status, headers: { 'Cache-Control': ERROR_CACHE_CONTROL } },
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') ?? '';
  const id = url.searchParams.get('id') ?? '';
  const modeParam = url.searchParams.get('mode') ?? 'albedo';
  const role = url.searchParams.get('role');
  if (role && !['albedo', 'normal', 'specular', 'mesh', 'morph', 'collision'].includes(role)) {
    return bad(400, 'unknown map role');
  }

  if (!kind || !id) return bad(400, 'kind and id are required');
  if (!KIND_TO_CATALOGUE[kind]) return bad(400, `unknown kind: ${kind}`);
  if (!(CONVERT_MODES as readonly string[]).includes(modeParam)) {
    return bad(400, `unknown mode: ${modeParam}`);
  }
  const mode = modeParam as ConvertMode;

  // Geometry is a mesh-kind concept. Asking for `mode=mesh` on a texture is a
  // caller bug, and a 400 is cheaper to diagnose than a worker crash.
  if (mode === 'mesh' && !isMeshKind(kind)) {
    return bad(422, `mesh mode is not available for kind ${kind}`);
  }

  let entry = await findEntry(kind, id, role);
  if (!entry) {
    const index = await readCatalogueIndex();
    return bad(404, 'id not found in catalogue', {
      catalogueAvailable: index.available,
      source: index.source,
    });
  }

  // Texture modes still refuse any row whose atlases are incomplete. Mesh mode
  // alone honours the producer's `untextured` exemption: the geometry decoded
  // cleanly and the renderer draws it flat grey, but no texture URL is emitted
  // for the missing refs.
  const untexturedMesh = mode === 'mesh' && entry.decodable !== false && entry.untextured === true;
  if (!untexturedMesh && (entry.unavailable || entry.available === false)) {
    return bad(422, entry.reason ?? 'Pack resource is unavailable');
  }

  if (mode === 'mesh') {
    // A greyed row can never reach the worker, even by hand-written URL: the
    // catalogue already knows why it cannot be decoded and the answer is
    // cheaper and more accurate than a failed decode.
    if (entry.decodable === false) {
      return bad(422, entry.reason ?? 'this mesh is not decodable', {
        mod: entry.mod,
        file: entry.file,
      });
    }
    // If the mesh is not a directly decodable format (.tri, .obj, .nif),
    // serve the authored companion geometry when one exists.
    if (!/\.(tri|obj|nif)$/i.test(entry.file)) {
      const geo = await companionGeometry(entry, kind);
      if (!geo) {
        return bad(422, entry.reason ?? 'no decodable geometry for this mesh', {
          mod: entry.mod,
          file: entry.file,
        });
      }
      entry = geo;
    }
  }

  try {
    // `convert` only returns bytes it confirmed fresh against the source file
    // and the converter (or just produced from them), so the ETag below always
    // describes current content.
    const result = await convert(kind, entry, mode, role);
    const body = new Uint8Array(result.bytes);
    const etag = responseEtag(
      'convert',
      body,
      [kind, entry.id, mode, role ?? '', entry.rel].join('\0'),
    );
    if (ifNoneMatchMatches(request, etag)) return notModifiedResponse(etag);
    return new Response(body, {
      headers: {
        'Content-Type': result.mime,
        'Content-Length': String(body.byteLength),
        ...revalidateHeaders(etag),
        'X-Mo2-Id': entry.id,
        'X-Mo2-Rel': encodeURIComponent(entry.rel),
        ...(result.iris ? { 'X-Mo2-Iris': JSON.stringify(result.iris) } : {}),
      },
    });
  } catch (err) {
    return bad(500, ASSET_SOURCE.layout === 'pack'
      ? 'Asset conversion failed: unsupported or invalid pack resource'
      : err instanceof Error ? err.message : 'conversion failed', {
      mod: entry.mod,
      file: entry.file,
      mode,
    });
  }
}
