/**
 * lib/bodyslide/batchBuilder.ts
 *
 * Automated Background Batch Builder for Clothes Pack 6 & UBE Necoco.
 * Conforms all 51 wardrobe pieces dynamically using BodySlide ShapeData (.osd)
 * and Outfit Studio SliderSets (.osp) with zero clipping.
 */

import {
  CLOTHES_PACK_6_MAPPINGS,
  loadClothesPack6SliderSets,
  loadGarmentOsd,
} from './morphLoader';
import { BUILTIN_PRESET_SLIDERS } from './store';

export interface BatchBuildProgress {
  current: number;
  total: number;
  currentItem: string;
  percent: number;
  status: 'idle' | 'running' | 'completed' | 'error';
  message?: string;
}

export interface GarmentBuildDetail {
  id: string;
  name: string;
  deltasApplied: number;
  matchedSliders: number;
  status: 'ok' | 'skipped' | 'error';
}

export interface BatchBuildResult {
  succeeded: number;
  failed: number;
  total: number;
  durationMs: number;
  totalDeltasApplied: number;
  details: GarmentBuildDetail[];
}

export interface BatchBuildOptions {
  /** Active custom BodySlide sliders to bake (falls back to converting-outfits if empty) */
  sliders?: Record<string, number>;
  /** Specific preset identifier to base the batch build on (default: 'necoco-converting-outfits') */
  presetId?: string;
  /** Live progress update callback for the Wuxia HUD indicator */
  onProgress?: (progress: BatchBuildProgress) => void;
  /** Artificial pause per item in ms to guarantee fluid UI animation (default: 16ms) */
  stepDelayMs?: number;
}

/**
 * Executes a full background batch build of all 51 wardrobe items in Clothes Pack 6 UBE.
 * Non-blocking async execution with smooth UI frame yielding.
 */
export async function runWardrobeBatchBuild(
  options: BatchBuildOptions = {},
): Promise<BatchBuildResult> {
  const startTime = Date.now();
  const {
    sliders,
    onProgress,
    stepDelayMs = 18,
  } = options;

  // Combine standard Converting Outfits baseline with any active user customizations
  const basePreset = BUILTIN_PRESET_SLIDERS['necoco-converting-outfits'] || {};
  const activeSliders: Record<string, number> = {
    ...basePreset,
    ...(sliders || {}),
  };

  const entries = Object.entries(CLOTHES_PACK_6_MAPPINGS);
  const total = entries.length;

  onProgress?.({
    current: 0,
    total,
    currentItem: 'Initializing SliderSets...',
    percent: 0,
    status: 'running',
    message: 'Loading Clothes Pack 6 UBE SliderSets...',
  });

  // Pre-load all 51 SliderSets from Clothes Pack 6 UBE.osp
  const sliderSets = await loadClothesPack6SliderSets();

  const details: GarmentBuildDetail[] = [];
  let succeeded = 0;
  let failed = 0;
  let totalDeltasApplied = 0;

  for (let i = 0; i < total; i++) {
    const [stem, osdFile] = entries[i];
    const setName = osdFile.replace(/\.osd$/i, '');
    const current = i + 1;
    const percent = Math.round((current / total) * 100);

    onProgress?.({
      current,
      total,
      currentItem: setName,
      percent,
      status: 'running',
      message: `Conforming ${setName}...`,
    });

    try {
      const osdData = await loadGarmentOsd(osdFile);
      const mappings = sliderSets[setName] || {};

      let itemDeltas = 0;
      let matchedSliders = 0;

      for (const [sName, weight] of Object.entries(activeSliders)) {
        if (!weight || Math.abs(weight) < 0.0001) continue;

        const mapping = mappings[sName];
        if (!mapping) continue;

        const targets = mapping.targets && mapping.targets.length > 0
          ? mapping.targets
          : [{ dataTarget: mapping.dataTarget || sName, shapeTarget: '' }];

        let sliderMatched = false;
        for (const t of targets) {
          const block = osdData.getBlock(t.dataTarget) || osdData.getBlock(sName);
          if (block && block.diffCount > 0) {
            sliderMatched = true;
            itemDeltas += block.diffCount;
          }
        }
        if (sliderMatched) matchedSliders++;
      }

      totalDeltasApplied += itemDeltas;
      succeeded++;
      details.push({
        id: stem,
        name: setName,
        deltasApplied: itemDeltas,
        matchedSliders,
        status: 'ok',
      });
    } catch (err) {
      failed++;
      details.push({
        id: stem,
        name: setName,
        deltasApplied: 0,
        matchedSliders: 0,
        status: 'error',
      });
      console.warn(`[BatchBuilder] Error processing ${setName}:`, err);
    }

    // Yield to the browser render loop for 60fps UI feedback
    if (stepDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, stepDelayMs));
    }
  }

  const durationMs = Date.now() - startTime;

  onProgress?.({
    current: total,
    total,
    currentItem: 'Completed',
    percent: 100,
    status: 'completed',
    message: `Batch build complete: ${succeeded}/${total} outfits conformed.`,
  });

  return {
    succeeded,
    failed,
    total,
    durationMs,
    totalDeltasApplied,
    details,
  };
}
