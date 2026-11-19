import { createHash } from 'node:crypto';

import { ASSET_SOURCE } from '@/lib/mo2/assetSource';

// IDs identify paths, not content. Revalidate local assets; never share-cache them.
export const REVALIDATE_CACHE_CONTROL = 'private, no-cache';
export const ERROR_CACHE_CONTROL = 'no-store';

export function responseEtag(
  route: string,
  body: string | Uint8Array,
  identity = '',
): string {
  const digest = createHash('sha256')
    .update(['v1', ASSET_SOURCE.id, ASSET_SOURCE.key, route, identity].join('\0'))
    .update('\0')
    .update(body)
    .digest('hex')
    .slice(0, 32);
  return `"${digest}"`;
}

export function ifNoneMatchMatches(request: Request, etag: string): boolean {
  const header = request.headers.get('if-none-match');
  if (!header) return false;
  if (header.trim() === '*') return true;
  return header.split(',').some((candidate) => {
    const tag = candidate.trim();
    return (tag.startsWith('W/') ? tag.slice(2) : tag) === etag;
  });
}

export function revalidateHeaders(etag: string): Record<string, string> {
  return { ETag: etag, 'Cache-Control': REVALIDATE_CACHE_CONTROL };
}

export function notModifiedResponse(etag: string): Response {
  return new Response(null, { status: 304, headers: revalidateHeaders(etag) });
}
