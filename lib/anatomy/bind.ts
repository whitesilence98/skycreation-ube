import { SLIDERS_BY_ID, type RegionId, type SliderId, type SliderValues } from '@/lib/regions';
import type { AnatomyParamId, AnatomyValues } from '@/lib/anatomy/params';

interface AnatomyBinding {
  region: RegionId;
  slider: SliderId;
  /** Maximum additional legacy-slider displacement from the existing face. */
  amount: number;
}
// ponytail: broad existing bone fields only; micro-shapes require authored targets and visual review.
export const ANATOMY_BINDINGS = {
  'nose.width': { region: 'nose', slider: 'width', amount: 8 },
  'nose.length': { region: 'nose', slider: 'length', amount: 6 },
  'mouth.width': { region: 'lips', slider: 'width', amount: 8 },
  'chin.length': { region: 'jaw', slider: 'length', amount: 6 },
  'jaw.width': { region: 'jaw', slider: 'width', amount: 8 },
  'cheekbone.height': { region: 'cheeks', slider: 'height', amount: 0.5 },
  'brow.positionY': { region: 'eyebrows', slider: 'height', amount: 0.5 },
} as const satisfies Partial<Record<AnatomyParamId, AnatomyBinding>>;

export function hasAnatomyBinding(id: string): id is keyof typeof ANATOMY_BINDINGS {
  return Object.hasOwn(ANATOMY_BINDINGS, id);
}

/** 50 adds nothing: entering Advanced preserves the existing face and unrelated channels. */
export function anatomySliderBank(region: RegionId, anatomy: AnatomyValues, base: SliderValues): SliderValues {
  const result = { ...base };
  for (const [id, binding] of Object.entries(ANATOMY_BINDINGS)) {
    if (binding.region !== region) continue;
    const value = anatomy[id as keyof typeof ANATOMY_BINDINGS];
    if (!Number.isFinite(value)) continue;
    const { min, max } = SLIDERS_BY_ID[binding.slider];
    const offset = (Math.min(100, Math.max(0, value)) - 50) / 50 * binding.amount;
    result[binding.slider] = Math.min(max, Math.max(min, base[binding.slider] + offset));
  }
  return result;
}
