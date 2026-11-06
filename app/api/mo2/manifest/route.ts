import { ASSET_SOURCE } from '@/lib/mo2/assetSource';
import { readManifest } from '@/lib/mo2/server';

export async function GET() {
  try {
    return Response.json(await readManifest(), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json(
      {
        available: false, source: ASSET_SOURCE.label, sourceId: ASSET_SOURCE.id,
        sourceLayout: ASSET_SOURCE.layout, sourceKey: ASSET_SOURCE.key,
        error: 'Active assets unavailable. Run npm run sync:assets and npm run sync:index.',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
