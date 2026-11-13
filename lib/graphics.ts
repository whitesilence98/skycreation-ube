/**
 * Graphics-panel metadata, kept in a plain `.ts` module.
 *
 * `lib/store.ts` is transpiled standalone by the check scripts, so anything
 * the store needs lives there; this module only holds the panel's table of
 * filter presets and the neutral-grade predicate, and imports the store's
 * types type-only (erased at runtime).
 */

import type { FilterPreset, GradeSettings } from '@/lib/store';

export interface FilterPresetSpec {
  id: FilterPreset;
  label: string;
  /** CSS swatch used as the thumbnail. The renderer's grade is the truth —
   *  there is no LUT texture in this project, so these are labels, not shots. */
  swatch: string;
}

/** Order matches the mockup: Dramatic, Cinematic, Fantasy, Vanilla. */
export const FILTER_PRESETS: readonly FilterPresetSpec[] = [
  {
    id: 'dramatic',
    label: 'Dramatic',
    swatch: 'linear-gradient(160deg,#cfdbe6 0%,#6d7d73 44%,#121614 100%)',
  },
  {
    id: 'cinematic',
    label: 'Cinematic',
    swatch: 'linear-gradient(160deg,#d8ccb4 0%,#7b6a4f 44%,#191410 100%)',
  },
  {
    id: 'fantasy',
    label: 'Fantasy',
    swatch: 'linear-gradient(160deg,#d8c6e8 0%,#7a6798 44%,#191222 100%)',
  },
  {
    id: 'vanilla',
    label: 'Vanilla',
    swatch: 'linear-gradient(160deg,#c9d3c5 0%,#6f7d6a 44%,#141914 100%)',
  },
] as const;

/** True when the grade pass would change nothing, so it can stay unmounted. */
export function isGradeNeutral(grade: GradeSettings): boolean {
  return (
    grade.contrast === 0 &&
    grade.saturation === 0 &&
    grade.filter === 'vanilla' &&
    grade.overlays.every((o) => !o.enabled || o.amount === 0)
  );
}
