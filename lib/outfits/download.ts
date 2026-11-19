import { parseOutfitSetFile, type OutfitSetFile } from '@/lib/outfits/records';

export function downloadOutfitSetJson(input: OutfitSetFile): void {
  const file = parseOutfitSetFile(input);
  if (!file) throw new TypeError('That outfit file is not valid.');
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const anchor = document.createElement('a');
  const url = URL.createObjectURL(blob);
  try {
    anchor.href = url;
    anchor.download = `lyra-outfit-${file.label.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'outfit'}.json`;
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
}
