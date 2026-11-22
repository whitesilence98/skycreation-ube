'use client';

import { create } from 'zustand';
import {
  REGIONS,
  type RegionId,
  type SliderValues,
} from '@/lib/regions';
import type { AnatomyMode } from '@/lib/anatomy/params';
import type { FaceSnapshot, CharacterState, GizmoPose } from '@/lib/store';
import { useCharacter } from '@/lib/store';
import type { SculptPayload, SmartFitMetrics } from '@/lib/head/sculptPayload';
import { removeDynamicHeadOption } from '@/lib/head/dynamicSculpt';
import {
  applySculptPreview,
  retargetHeadObj,
  SmartRetargetError,
} from '@/lib/smart/retarget';

/**
 * Smart Customization session — single owner of the OBJ → UBE sculpt flow.
 *
 * The Zustand store holds only the reactive slice the screen/footer render.
 * Request ownership (AbortController + sequence token) and the face transaction
 * live as module singletons, so body and footer cancel/commit the same request
 * and a stale response can never assign.
 *
 * Preview is a face transaction: snapshot at preview time (not upload), then
 * neutralise (zero sliders, identity poses — `poseBone` adds value*gain with
 * no default subtraction — legacy anatomy, linkFaceToWeight off) and select the
 * dynamic head. Cancel/failure/navigation restores the exact snapshot including
 * the history `setAssets` rebased away; Apply keeps the neutral face and drops
 * the snapshot. No persistence: the `.jslot` download is the only durable copy.
 */

export type SmartStatus = 'idle' | 'converting' | 'preview-ready' | 'rejected' | 'image';

export interface StagedSculpt {
  /** Original uploaded `.obj` name, for display and the toast. */
  name: string;
  /** Registered dynamic head option currently worn as the preview. */
  headOptionId: string;
  /** Head worn before the preview; restored on Cancel. */
  previousHeadId: string | null;
  metrics: SmartFitMetrics;
  /** Front-projected fitted-UBE edges for the ring. */
  previewEdges: Float32Array;
  /** Authoritative payload used for replay and offered for download. */
  sculpt: SculptPayload;
  /** Payload name, used for the download filename. */
  sculptName: string;
}

interface SmartSession {
  status: SmartStatus;
  error: string | null;
  imageUrl: string | null;
  staged: StagedSculpt | null;
  /** True while the preview head is worn and not yet committed/discarded. */
  applied: boolean;
  /** True once the staged sculpt has been downloaded this session. */
  downloaded: boolean;
  setStatus: (status: SmartStatus) => void;
  setError: (error: string | null) => void;
  setImageUrl: (url: string | null) => void;
  /** Show a photo preview (no generation exists yet). */
  showImage: (url: string) => void;
  /** Enter the converting state, clearing any previous result. */
  beginConversion: () => void;
  /** Surface an explicit rejection (unsupported file, converter failure). */
  reject: (message: string) => void;
  reset: () => void;
}

const IDLE = {
  status: 'idle' as const,
  error: null,
  imageUrl: null,
  staged: null,
  applied: false,
  downloaded: false,
};

export const useSmartSession = create<SmartSession>()((set) => ({
  ...IDLE,
  setStatus: (status) => set({ status }),
  setError: (error) => set({ error }),
  setImageUrl: (imageUrl) => set({ imageUrl }),
  showImage: (imageUrl) => set({ ...IDLE, status: 'image', imageUrl }),
  beginConversion: () => set({ ...IDLE, status: 'converting' }),
  reject: (error) => set({ ...IDLE, status: 'rejected', error }),
  reset: () => set({ ...IDLE }),
}));

/* ── Face transaction ─────────────────────────────────────────────────────── */

interface FacePreviewSnapshot {
  sliders: Record<RegionId, SliderValues>;
  poses: Record<RegionId, GizmoPose>;
  anatomyMode: AnatomyMode;
  linkFaceToWeight: boolean;
  facePast: FaceSnapshot[];
  faceFuture: FaceSnapshot[];
  faceEditStart: FaceSnapshot | null;
  faceCompareStart: FaceSnapshot | null;
  faceBaseline: FaceSnapshot | null;
  previousHeadId: string | null;
}

const zeroSliders = (): SliderValues => ({
  length: 0, width: 0, depth: 0, height: 0, angle: 0, protrusion: 0,
});

const identity = (): GizmoPose => ({
  offset: [0, 0, 0], rotation: [0, 0, 0], scale: [0, 0, 0],
});

const neutralSliderBank = (): Record<RegionId, SliderValues> =>
  Object.fromEntries(REGIONS.map((r) => [r.id, zeroSliders()])) as Record<RegionId, SliderValues>;

const neutralPoseBank = (): Record<RegionId, GizmoPose> =>
  Object.fromEntries(REGIONS.map((r) => [r.id, identity()])) as Record<RegionId, GizmoPose>;

const clonePose = (p: GizmoPose): GizmoPose => ({
  offset: [p.offset[0], p.offset[1], p.offset[2]],
  rotation: [p.rotation[0], p.rotation[1], p.rotation[2]],
  scale: [p.scale[0], p.scale[1], p.scale[2]],
});

const cloneSliders = (bank: Record<RegionId, SliderValues>): Record<RegionId, SliderValues> =>
  Object.fromEntries(REGIONS.map((r) => [r.id, { ...bank[r.id] }])) as Record<RegionId, SliderValues>;

const clonePoses = (bank: Record<RegionId, GizmoPose>): Record<RegionId, GizmoPose> =>
  Object.fromEntries(REGIONS.map((r) => [r.id, clonePose(bank[r.id])])) as Record<RegionId, GizmoPose>;

function captureFaceSnapshot(): FacePreviewSnapshot {
  const s = useCharacter.getState();
  return {
    sliders: cloneSliders(s.sliders),
    poses: clonePoses(s.poses),
    anatomyMode: s.anatomyMode,
    linkFaceToWeight: s.linkFaceToWeight,
    facePast: s.facePast.slice(),
    faceFuture: s.faceFuture.slice(),
    faceEditStart: s.faceEditStart,
    faceCompareStart: s.faceCompareStart,
    faceBaseline: s.faceBaseline,
    previousHeadId: s.assetSelection.headMesh ?? null,
  };
}

/** Neutral face + fitted head in one atomic write; hair, equipment, lighting
 *  and body anatomy are untouched. History is cleared as `setAssets` would on a
 *  head change — the snapshot taken just before restores it. */
function applyNeutralPreview(optionId: string): void {
  useCharacter.setState((s): Partial<CharacterState> => ({
    sliders: neutralSliderBank(),
    poses: neutralPoseBank(),
    anatomyMode: 'legacy',
    linkFaceToWeight: false,
    assetSelection: { ...s.assetSelection, headMesh: optionId },
    facePast: [],
    faceFuture: [],
    faceEditStart: null,
    faceCompareStart: null,
    faceBaseline: null,
  }));
}

/** Put the exact snapshotted face back, including the rebased-away history. */
function restoreFaceSnapshot(snap: FacePreviewSnapshot): void {
  useCharacter.setState((s): Partial<CharacterState> => {
    const assetSelection = { ...s.assetSelection };
    if (snap.previousHeadId) assetSelection.headMesh = snap.previousHeadId;
    else delete assetSelection.headMesh;
    return {
      sliders: cloneSliders(snap.sliders),
      poses: clonePoses(snap.poses),
      anatomyMode: snap.anatomyMode,
      linkFaceToWeight: snap.linkFaceToWeight,
      assetSelection,
      facePast: snap.facePast.slice(),
      faceFuture: snap.faceFuture.slice(),
      faceEditStart: snap.faceEditStart,
      faceCompareStart: snap.faceCompareStart,
      faceBaseline: snap.faceBaseline,
    };
  });
}

/* ── Request owner (module singleton) ─────────────────────────────────────── */

/** In-flight conversion, or null. Owned here, never by a component ref. */
let activeController: AbortController | null = null;
/** Bumped by every lifecycle call; a response whose token no longer matches is stale. */
let sequence = 0;
/** Face snapshot taken at preview time, restored on discard/failure. */
let stagedSnapshot: FacePreviewSnapshot | null = null;

function abortActive(): void {
  if (activeController) {
    activeController.abort();
    activeController = null;
  }
}

/**
 * Start fitting `file` onto the UBE base.
 *
 * Any prior preview is restored and removed first, and any in-flight request is
 * aborted, so a rapid second upload always supersedes the first. The returned
 * promise resolves when the session has settled; callers need not await it.
 */
export async function startConversion(file: File): Promise<void> {
  discardPreview();

  const controller = new AbortController();
  activeController = controller;
  const token = ++sequence;
  const stale = () => token !== sequence || controller.signal.aborted;

  useSmartSession.getState().beginConversion();

  try {
    const { sculpt, metrics } = await retargetHeadObj(file, controller.signal);
    if (stale()) return;

    const { option, previewEdges } = await applySculptPreview(sculpt, file.name);
    /* A Cancel/Esc/unmount may land while the replay base was being fetched.
       Nothing has been assigned yet, so drop the freshly registered option. */
    if (stale()) {
      removeDynamicHeadOption(option.id);
      return;
    }

    /* Snapshot after the async work, so edits made during conversion are the
       restore target. Store it before neutralising; if assignment throws (the
       persisted store can throw after mutating), put the exact face back. */
    const snapshot = captureFaceSnapshot();
    stagedSnapshot = snapshot;
    try {
      applyNeutralPreview(option.id);
    } catch (caught) {
      try { restoreFaceSnapshot(snapshot); } catch { /* best-effort restore */ }
      stagedSnapshot = null;
      removeDynamicHeadOption(option.id);
      throw caught;
    }

    useSmartSession.setState({
      status: 'preview-ready',
      error: null,
      applied: true,
      downloaded: false,
      staged: {
        name: file.name,
        headOptionId: option.id,
        previousHeadId: snapshot.previousHeadId,
        metrics,
        previewEdges,
        sculpt,
        sculptName: sculpt.name || file.name,
      },
    });
    useCharacter.getState().showToast(`Previewing ${file.name} (approximate sculpt)`);
  } catch (caught) {
    if (stale()) return;
    // A store subscriber or persistence write can throw after preview assignment.
    if (stagedSnapshot) {
      try { discardPreview(); } catch { /* in-memory rollback precedes persistence */ }
    }
    const message = caught instanceof SmartRetargetError
      ? caught.message
      : caught instanceof Error && caught.message
        ? caught.message
        : 'The head could not be fitted. Nothing was applied.';
    useSmartSession.getState().reject(message);
  } finally {
    if (activeController === controller) activeController = null;
  }
}

/**
 * Cancel anything in flight, restore a staged preview, and reset the session.
 *
 * Used by Discard, `Esc`, an superseding upload, and unmount/navigation. Safe to
 * call when nothing is staged. The dynamic head option is removed after the
 * previous head is restored, so the picker never shows a phantom head.
 */
export function discardPreview(options?: { toast?: string }): void {
  sequence += 1;
  abortActive();

  const session = useSmartSession.getState();
  const staged = session.staged;
  const snapshot = stagedSnapshot;
  stagedSnapshot = null;

  try {
    if (snapshot) restoreFaceSnapshot(snapshot);
  } finally {
    if (staged) removeDynamicHeadOption(staged.headOptionId);
    session.reset();
  }
  if (options?.toast) useCharacter.getState().showToast(options.toast);
}

/**
 * Commit the preview: keep the neutral face on the fitted head and leave.
 *
 * The snapshot is dropped *before* the session resets, so the unmount that
 * follows `setStudioPage('default')` cannot restore the old face. Returns false
 * when there is no preview to apply (the footer keeps Apply disabled anyway).
 */
export function applyPreview(): boolean {
  const session = useSmartSession.getState();
  if (session.status !== 'preview-ready' || !session.staged) return false;

  sequence += 1;
  abortActive();
  stagedSnapshot = null;

  const staged = session.staged;
  const downloaded = session.downloaded;
  session.reset();

  /* The warning must have been shown before Apply — after leaving the screen
     there is no download button. This toast only states what is durable. */
  useCharacter.getState().showToast(
    downloaded
      ? `Applied ${staged.name} — reload it from the downloaded .jslot`
      : `Applied ${staged.name} — session only; this face will not survive reload`,
  );
  useCharacter.getState().setStudioPage('default');
  return true;
}

/** Mark the staged sculpt as downloaded so Apply stops warning it is session-only. */
export function markDownloaded(): void {
  useSmartSession.setState({ downloaded: true });
}
