'use client';

import { useCharacter } from '@/lib/store';
import { ANATOMY_BY_ID, ANATOMY_PARAMS } from '@/lib/anatomy/params';
import { useBodySlideStore, type BodySnapshot } from './store';
import { runWardrobeBatchBuild } from './batchBuilder';

const BODY_ANATOMY_PARAMS = ANATOMY_PARAMS.filter((p) => p.group === 'body');

/** Build the default body-group skeleton anatomy map. */
export function defaultBodyAnatomy(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of BODY_ANATOMY_PARAMS) {
    out[p.id] = p.default;
  }
  return out;
}

/** Capture current Physique sliders + body skeleton scale values. */
export function capturePhysiqueSnapshot(): BodySnapshot {
  const userSliders = { ...useBodySlideStore.getState().userSliders };
  const anatomy = useCharacter.getState().anatomy;
  const bodyAnatomy: Record<string, number> = {};
  for (const p of BODY_ANATOMY_PARAMS) {
    bodyAnatomy[p.id] = anatomy[p.id] ?? p.default;
  }
  return { userSliders, bodyAnatomy };
}

/** Restore a Physique snapshot onto both BodySlide and character skeleton stores. */
export function applyPhysiqueSnapshot(snap: BodySnapshot): void {
  const sliders = snap.userSliders ?? {};
  const presetId = Object.keys(sliders).length === 0 ? 'default-slim' : null;
  useBodySlideStore.getState().replaceUserSliders(sliders, presetId);

  const defaults = defaultBodyAnatomy();
  useCharacter.getState().setBodyAnatomyBatch({
    ...defaults,
    ...(snap.bodyAnatomy ?? {}),
  });
}

function slidersEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const va = a[k] ?? 0;
    const vb = b[k] ?? 0;
    if (Math.abs(va - vb) > 0.001) return false;
  }
  return true;
}

function anatomyEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  for (const p of BODY_ANATOMY_PARAMS) {
    const va = a[p.id] ?? p.default;
    const vb = b[p.id] ?? p.default;
    if (Math.abs(va - vb) > 0.001) return false;
  }
  return true;
}

export function snapshotsEqual(a: BodySnapshot, b: BodySnapshot): boolean {
  return slidersEqual(a.userSliders, b.userSliders) && anatomyEqual(a.bodyAnatomy, b.bodyAnatomy);
}

/** Begin a slider drag transaction (batches continuous changes into one undo entry). */
export function beginPhysiqueEdit(): void {
  const bs = useBodySlideStore.getState();
  if (bs.compareStartSnapshot || bs.editStartSnapshot) return;
  bs.setEditStartSnapshot(capturePhysiqueSnapshot());
}

/** Commit the active slider drag transaction if any value actually changed. */
export function endPhysiqueEdit(): void {
  const bs = useBodySlideStore.getState();
  const start = bs.editStartSnapshot;
  if (!start) return;
  bs.setEditStartSnapshot(null);
  const current = capturePhysiqueSnapshot();
  if (!snapshotsEqual(start, current)) {
    bs.pushBodyPast(start);
  }
}

/** Wrap an instantaneous Physique mutation (reset, preset, double-click) as one undo step. */
export function recordPhysiqueStep(mutate: () => void): void {
  endPhysiqueEdit();
  endPhysiqueCompare();
  const before = capturePhysiqueSnapshot();
  mutate();
  const after = capturePhysiqueSnapshot();
  if (!snapshotsEqual(before, after)) {
    useBodySlideStore.getState().pushBodyPast(before);
  }
}

/** Step back one Physique edit. */
export function undoPhysique(): boolean {
  endPhysiqueEdit();
  const bs = useBodySlideStore.getState();
  if (bs.compareStartSnapshot) return false;
  const current = capturePhysiqueSnapshot();
  const prev = bs.popBodyUndo(current);
  if (!prev) return false;
  applyPhysiqueSnapshot(prev);
  useCharacter.getState().showToast('Undid Physique edit');
  return true;
}

/** Step forward one Physique edit. */
export function redoPhysique(): boolean {
  endPhysiqueEdit();
  const bs = useBodySlideStore.getState();
  if (bs.compareStartSnapshot) return false;
  const current = capturePhysiqueSnapshot();
  const next = bs.popBodyRedo(current);
  if (!next) return false;
  applyPhysiqueSnapshot(next);
  useCharacter.getState().showToast('Redid Physique edit');
  return true;
}

/** Discard uncommitted draft edits and return to the most recently saved Physique checkpoint. */
export function revertPhysiqueToSaved(): boolean {
  endPhysiqueEdit();
  endPhysiqueCompare();
  const bs = useBodySlideStore.getState();
  const target: BodySnapshot = {
    userSliders: { ...bs.savedSliders },
    bodyAnatomy: { ...defaultBodyAnatomy(), ...bs.savedAnatomy },
  };
  const current = capturePhysiqueSnapshot();
  if (snapshotsEqual(current, target)) {
    useCharacter.getState().showToast('Already at last saved Physique');
    return false;
  }
  bs.pushBodyPast(current);
  applyPhysiqueSnapshot(target);
  useCharacter.getState().showToast('Reverted to last saved Physique');
  return true;
}

/** Reset all Physique morphs and skeleton scales to clean _0 defaults (undoable via Ctrl+Z). */
export function resetPhysiqueToDefault(): boolean {
  endPhysiqueEdit();
  endPhysiqueCompare();
  const bs = useBodySlideStore.getState();
  const target: BodySnapshot = {
    userSliders: {},
    bodyAnatomy: defaultBodyAnatomy(),
  };
  const current = capturePhysiqueSnapshot();
  if (snapshotsEqual(current, target)) {
    useCharacter.getState().showToast('Physique is already at default');
    return false;
  }
  bs.pushBodyPast(current);
  applyPhysiqueSnapshot(target);
  useCharacter.getState().showToast('Reset Physique to default (Ctrl+Z to undo)');
  return true;
}

/** Hold-to-compare: temporarily show the last saved Physique checkpoint. */
export function beginPhysiqueCompare(): void {
  endPhysiqueEdit();
  const bs = useBodySlideStore.getState();
  if (bs.compareStartSnapshot) return;
  const live = capturePhysiqueSnapshot();
  bs.setCompareStartSnapshot(live);
  applyPhysiqueSnapshot({
    userSliders: { ...bs.savedSliders },
    bodyAnatomy: { ...defaultBodyAnatomy(), ...bs.savedAnatomy },
  });
}

/** End hold-to-compare and restore the active draft edits. */
export function endPhysiqueCompare(): void {
  const bs = useBodySlideStore.getState();
  const live = bs.compareStartSnapshot;
  if (!live) return;
  bs.setCompareStartSnapshot(null);
  applyPhysiqueSnapshot(live);
}

/** Commit Physique checkpoint to localStorage and run the 51-outfit batch conform modal. */
export async function saveAndBatchBuildPhysique(): Promise<void> {
  endPhysiqueEdit();
  endPhysiqueCompare();
  const bs = useBodySlideStore.getState();
  if (bs.isBatchBuilding) return;

  const snap = capturePhysiqueSnapshot();
  bs.setIsBatchBuilding(true);
  bs.setBatchModalOpen(true);
  try {
    const { clothedSliders } = bs.saveBodyConfig(undefined, snap.bodyAnatomy);
    await runWardrobeBatchBuild({
      sliders: clothedSliders,
      onProgress: (p) => useBodySlideStore.getState().setBatchProgress(p),
    });
    useCharacter.getState().showToast('Physique saved & wardrobe conformed');
  } catch (err) {
    console.error('[PhysiqueSave] Batch build failed:', err);
  } finally {
    useBodySlideStore.getState().setIsBatchBuilding(false);
  }
}

/** Reactive selector returning true whenever live Physique differs from the last saved checkpoint. */
export function usePhysiqueDirty(): boolean {
  const userSliders = useBodySlideStore((s) => s.userSliders);
  const savedSliders = useBodySlideStore((s) => s.savedSliders);
  const savedAnatomy = useBodySlideStore((s) => s.savedAnatomy);
  const compareStart = useBodySlideStore((s) => s.compareStartSnapshot);
  const anatomy = useCharacter((s) => s.anatomy);

  const liveSliders = compareStart ? compareStart.userSliders : userSliders;
  const liveAnatomy: Record<string, number> = {};
  for (const p of BODY_ANATOMY_PARAMS) {
    liveAnatomy[p.id] = compareStart
      ? (compareStart.bodyAnatomy[p.id] ?? p.default)
      : (anatomy[p.id] ?? ANATOMY_BY_ID[p.id].default);
  }

  return !slidersEqual(liveSliders, savedSliders) || !anatomyEqual(liveAnatomy, savedAnatomy);
}
