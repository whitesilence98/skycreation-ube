import type { AnatomyGroupId, AnatomyParamId, AnatomyValues } from '@/lib/anatomy/params';

export interface AnatomyPreset {
  id: string; group: AnatomyGroupId; label: string;
  values: Partial<AnatomyValues>; draft: true;
}
// ponytail: these are draft parameter samples, not authored mesh shapes; replace after visual review.
const samples = (group: AnatomyGroupId, count: number, label: string, ids: readonly AnatomyParamId[]): AnatomyPreset[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `${group}.draft-${i + 1}`, group, label: `${label} ${i + 1}`, draft: true,
    values: Object.fromEntries(ids.map((id, j) => [id, 25 + ((i * (j + 2) * 7 + j * 11) % 51)])),
  }));
export const ANATOMY_PRESETS: AnatomyPreset[] = [
  ...samples('eyes', 12, 'Eye draft', ['eye.size', 'eye.angle', 'eyelid.openness']),
  ...samples('brows', 15, 'Brow draft', ['brow.thickness', 'brow.angle', 'brow.density']),
  // Tip geometry is not available; these are placeholders for the future tip-specific mapping.
  ...Array.from({ length: 8 }, (_, i): AnatomyPreset => ({
    id: `nose.draft-${i + 1}`, group: 'nose', label: `Tip draft ${i + 1}`, values: {}, draft: true,
  })),
  ...samples('mouth', 10, 'Lip draft', ['lip.fullness', 'lip.definition']),
  ...samples('ears', 5, 'Ear draft', ['ear.size', 'ear.angle']),
  ...(['Slim', 'Athletic', 'Muscular', 'Heavy'] as const).map((label, i): AnatomyPreset => ({
    id: `body.${label.toLowerCase()}`, group: 'body', label: `${label} (draft)`, draft: true,
    values: { 'body.fat': [25, 35, 30, 75][i], 'body.muscleDefinition': [30, 65, 85, 40][i] },
  })),
];
export const IRIS_COLORS = [
  '#35251d', '#59412b', '#80634a', '#aa8854', '#c4a567', '#555b32', '#77804a', '#3b6048',
  '#618a70', '#7a9e91', '#294b65', '#497795', '#739daf', '#a7bfc8', '#555963', '#828995',
  '#b6b8bd', '#795454', '#665179', '#9a869e',
] as const;
export const LIP_COLORS = [
  '#a85c66', '#c87c86', '#d9989e', '#e4b1b0', '#bc7976', '#92504e', '#733c44', '#9c3c50',
  '#b84a5a', '#d05b63', '#93475f', '#ad6a83', '#7c506b', '#8c6159', '#b88978',
] as const;
