import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const config = JSON.parse(readFileSync(path.join(projectRoot, 'asset-source.json'), 'utf8')) as {
  layout?: unknown; root?: unknown; publicBase?: unknown;
};
if (config.layout !== 'pack' && config.layout !== 'mo2') throw new Error('Invalid asset source layout');
if (typeof config.root !== 'string' || !path.isAbsolute(config.root)) throw new Error('Asset root must be absolute');
if (typeof config.publicBase !== 'string' || !/^\/assets\/[a-z0-9-]+$/.test(config.publicBase)) {
  throw new Error('Asset publicBase must be a single /assets namespace');
}
if (config.publicBase !== (config.layout === 'pack' ? '/assets/preset-pack' : '/assets/mo2')) {
  throw new Error('Pack and legacy assets must use separate output namespaces');
}

const root = config.layout === 'mo2' ? process.env.MO2_MODS_ROOT ?? config.root : config.root;

export const ASSET_SOURCE = {
  layout: config.layout as 'pack' | 'mo2',
  key: createHash('sha256').update(path.resolve(root).replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()).digest('hex').slice(0, 16),
  id: config.layout === 'pack' ? 'preset-pack' : 'mo2',
  label: config.layout === 'pack' ? 'Skyrim Preset For App' : 'MO2',
  root,
  publicBase: config.publicBase,
  output: path.join(projectRoot, 'public', config.publicBase),
};
