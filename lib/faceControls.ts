import { ANATOMY_PARAMS, type AnatomyParamId } from '@/lib/anatomy/params';
import { ANATOMY_BINDINGS } from '@/lib/anatomy/bind';
import type { RegionId } from '@/lib/regions';

export const FACE_SECTIONS = [
  { id: 'forehead', label: 'Face Shape', region: 'forehead', groups: ['face'] },
  { id: 'eyebrows', label: 'Brows', region: 'eyebrows', groups: ['brows'] },
  { id: 'eyes', label: 'Eyes', region: 'eyes', groups: ['eyes'] },
  { id: 'nose', label: 'Nose', region: 'nose', groups: ['nose'] },
  { id: 'cheeks', label: 'Cheeks', region: 'cheeks', groups: ['face'] },
  { id: 'lips', label: 'Lips', region: 'lips', groups: ['mouth'] },
  { id: 'jaw', label: 'Jaw & chin', region: 'jaw', groups: ['face'] },
  { id: 'ears', label: 'Ears', region: 'ears', groups: ['ears'] },
] as const;
export type FaceSectionId = (typeof FACE_SECTIONS)[number]['id'];
export const EDITOR_CATEGORIES = ['preset', 'face', 'hair', 'body', 'outfit', 'styling'] as const;
export type EditorCategory = (typeof EDITOR_CATEGORIES)[number];
export const CATEGORY_LABELS: Record<EditorCategory, string> = {
  preset: 'Presets', face: 'Features', hair: 'Hair', body: 'Body', outfit: 'Outfit', styling: 'Styling',
};
export function editorCategory(primary: string): EditorCategory {
  if (primary === 'FACE SHAPE') return 'face';
  if (primary === 'FACE') return 'styling';
  if (primary === 'HAIR') return 'hair';
  if (primary === 'BODY') return 'body';
  if (primary === 'EQUIPMENT') return 'outfit';
  return 'preset';
}
export function faceControlIds(region: RegionId): AnatomyParamId[] {
  return ANATOMY_PARAMS.filter(p => p.status === 'wired' &&
    ANATOMY_BINDINGS[p.id as keyof typeof ANATOMY_BINDINGS]?.region === region).map(p => p.id);
}
export function storedFaceControlIds(section: FaceSectionId): AnatomyParamId[] {
  const entry = FACE_SECTIONS.find(s => s.id === section)!;
  return ANATOMY_PARAMS.filter(p => p.status !== 'wired' &&
    (entry.groups as readonly string[]).includes(p.group)).map(p => p.id);
}
