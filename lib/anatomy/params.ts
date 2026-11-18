import { hasAnatomyBinding } from '@/lib/anatomy/bind';

export const ANATOMY_GROUPS = {
  face: 'Face & Jawline', eyes: 'Eyes', brows: 'Eyebrows', nose: 'Nose',
  mouth: 'Mouth & Lips', ears: 'Ears', body: 'Body Build', surface: 'Surface',
} as const;
export type AnatomyGroupId = keyof typeof ANATOMY_GROUPS;
export type AnatomyMode = 'legacy' | 'advanced';

type Param = {
  id: string; group: AnatomyGroupId; label: string; min: number; max: number;
  default: number; step: number; bilateral: boolean;
  target: 'rig' | 'morph' | 'material'; status: 'stored-only' | 'wired';
};
function param<const Id extends string>(id: Id, group: AnatomyGroupId, label: string,
  target: Param['target'] = 'morph', bilateral = false,
  min = 0, max = 100, initial = 50) {
  return { id, group, label, target: hasAnatomyBinding(id) ? 'rig' as const : target, bilateral, min, max, default: initial,
    step: 1, status: hasAnatomyBinding(id) ? 'wired' as const : 'stored-only' as const };
}

/** Broad bindings reuse existing rig fields; precise micro-shapes remain stored-only. */
export const ANATOMY_PARAMS = [
  param('face.width', 'face', 'Face width'),
  param('face.length', 'face', 'Face length'),
  param('jaw.width', 'face', 'Jaw width', 'morph', true),
  param('jaw.contour', 'face', 'Jaw contour'),
  param('chin.length', 'face', 'Chin length'),
  param('cheekbone.height', 'face', 'Cheekbone height', 'rig', true),
  param('cheekbone.angle', 'face', 'Cheekbone angle', 'morph', true),
  param('glabella.prominence', 'face', 'Glabella prominence'),
  param('brow.archHeight', 'face', 'Brow arch height', 'morph', true),
  param('brow.archAngle', 'face', 'Brow arch angle', 'morph', true),
  param('brow.archSharpness', 'face', 'Brow arch sharpness', 'morph', true),
  param('skin.maturity', 'face', 'Skin maturity (adult detail)', 'material'),
  param('eye.size', 'eyes', 'Eye opening size', 'morph', true),
  param('eye.spacing', 'eyes', 'Eye spacing', 'rig'),
  param('eye.angle', 'eyes', 'Eye angle', 'morph', true),
  param('eye.height', 'eyes', 'Eye height', 'rig', true),
  param('eyelid.openness', 'eyes', 'Eyelid openness', 'morph', true),
  param('eye.socketDepth', 'eyes', 'Socket depth', 'morph', true),
  param('eye.innerCanthusAngle', 'eyes', 'Inner canthus angle', 'morph', true),
  param('eye.outerCanthusAngle', 'eyes', 'Outer canthus angle', 'morph', true),
  param('pupil.size', 'eyes', 'Pupil size', 'material'),
  param('eye.gloss', 'eyes', 'Eye gloss', 'material'),
  param('eye.wetness', 'eyes', 'Eye wetness', 'material'),
  param('brow.thickness', 'brows', 'Brow thickness', 'morph', true),
  param('brow.angle', 'brows', 'Brow angle', 'rig', true),
  param('brow.positionX', 'brows', 'Brow horizontal position', 'rig', true),
  param('brow.positionY', 'brows', 'Brow vertical position', 'rig', true),
  param('brow.density', 'brows', 'Brow density', 'material'),
  param('nose.bridgeHeight', 'nose', 'Bridge height'),
  param('nose.width', 'nose', 'Nose width'),
  param('nose.length', 'nose', 'Nose length'),
  param('nostril.size', 'nose', 'Nostril size', 'morph', true),
  param('nostril.width', 'nose', 'Nostril width', 'morph', true),
  param('nose.columella', 'nose', 'Columella'),
  param('lip.fullness', 'mouth', 'Lip fullness'),
  param('mouth.width', 'mouth', 'Mouth width'),
  param('philtrum.depth', 'mouth', 'Philtrum depth'),
  param('lip.definition', 'mouth', 'Lip definition'),
  param('mouth.cornerHeight', 'mouth', 'Mouth corner height', 'morph', true),
  param('ear.size', 'ears', 'Ear size', 'morph', true),
  param('ear.angle', 'ears', 'Ear angle', 'rig', true),
  param('body.heightCm', 'body', 'Standing height (cm)', 'rig', false, 150, 200, 170),
  param('body.muscleDefinition', 'body', 'Muscle definition', 'material'),
  param('body.fat', 'body', 'Body fat'),
  param('body.shoulderWidth', 'body', 'Shoulder width'),
  param('body.chestSize', 'body', 'Chest size'),
  param('body.waistSize', 'body', 'Waist size'),
  param('body.hipWidth', 'body', 'Hip width'),
  param('body.armLength', 'body', 'Arm length', 'rig'),
  param('body.legLength', 'body', 'Leg length', 'rig'),
  param('skin.tone', 'surface', 'Skin tone', 'material'),
] as const;
export type AnatomyParamId = (typeof ANATOMY_PARAMS)[number]['id'];
export type AnatomyValues = Record<AnatomyParamId, number>;
export type AnatomyAsymmetry = Partial<Record<AnatomyParamId, number>>;
export const ANATOMY_BY_ID = Object.fromEntries(ANATOMY_PARAMS.map(p => [p.id, p])) as Record<AnatomyParamId, Param>;

export const ANATOMY_COLOR_DEFS = [
  { id: 'iris.color', group: 'eyes', label: 'Iris color', default: '#80634a' },
  { id: 'facialHair.color', group: 'surface', label: 'Facial hair color', default: '#30231c' },
  { id: 'makeup.lipColor.color', group: 'surface', label: 'Lip color', default: '#a85c66' },
] as const;
export type AnatomyColorId = (typeof ANATOMY_COLOR_DEFS)[number]['id'];
export type AnatomyColors = Record<AnatomyColorId, string>;
export interface AnatomySnapshot {
  anatomy: AnatomyValues;
  anatomyAsymmetry: AnatomyAsymmetry;
  anatomyColors: AnatomyColors;
}
