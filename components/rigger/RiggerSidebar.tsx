'use client';

import * as THREE from 'three';
import { useRef } from 'react';
import { useRiggerStore, areAllLandmarksSet } from '@/lib/rigger/store';
import {
  LANDMARK_IDS,
  getLandmarkIdsForPreset,
  type LandmarkId,
  type LandmarkMap,
  type LandmarkPreset,
} from '@/lib/rigger/vrmSkeleton';
import { LANDMARK_META } from '@/components/rigger/LandmarkEditor';
import { ExportPanel } from '@/components/rigger/ExportPanel';
import { TargetEngineSelector } from '@/components/rigger/TargetEngineSelector';
import { getEngineProfile } from '@/lib/rigger/engineProfiles';
import { fitSkeletonToLandmarks, estimateLandmarksFromBounds, validateLandmarks } from '@/lib/rigger/templateFitter';
import { transferWeightsAsync } from '@/lib/rigger/weightTransfer';
import { diffuseWeightsAsync } from '@/lib/rigger/heatDiffusion';

// ── Step indicator ────────────────────────────────────────────────────────────

function StepDot({ n, active, done }: { n: number; active: boolean; done: boolean }) {
  return (
    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold border-2 transition-all ${
      done  ? 'bg-emerald-500 border-emerald-500 text-white' :
      active ? 'bg-sky-500 border-sky-400 text-white shadow-[0_0_10px_rgba(14,165,233,0.5)]' :
               'bg-zinc-800 border-zinc-700 text-zinc-500'
    }`}>
      {done ? '✓' : n}
    </div>
  );
}

export function RiggerStepBar({ step }: { step: 1 | 2 | 3 }) {
  const steps = ['Rig', 'Preview', 'Export'];
  return (
    <div className="flex items-center gap-1 px-1">
      {steps.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const done   = step > n;
        const active = step === n;
        return (
          <div key={n} className="flex items-center gap-1 flex-1">
            <div className="flex flex-col items-center gap-0.5 min-w-0">
              <StepDot n={n} active={active} done={done} />
              <span className={`text-[10px] font-medium truncate max-w-[68px] text-center ${
                active ? 'text-sky-300' : done ? 'text-emerald-400' : 'text-zinc-500'
              }`}>{label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-px mb-3 ${done ? 'bg-emerald-500' : 'bg-zinc-700'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function RiggerSidebar() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Store state
  const stage                 = useRiggerStore((s) => s.stage);
  const uiPhase               = useRiggerStore((s) => s.uiPhase);
  const meshFile              = useRiggerStore((s) => s.meshFile);
  const meshGeometry          = useRiggerStore((s) => s.meshGeometry);
  const meshBbox              = useRiggerStore((s) => s.meshBbox);
  const landmarks             = useRiggerStore((s) => s.landmarks);
  const landmarkPreset        = useRiggerStore((s) => s.landmarkPreset);
  const landmarkMode          = useRiggerStore((s) => s.landmarkMode);
  const activeLandmark        = useRiggerStore((s) => s.activeLandmark);
  const progress              = useRiggerStore((s) => s.progress);
  const error                 = useRiggerStore((s) => s.error);
  const characterName         = useRiggerStore((s) => s.characterName);
  const exportTarget          = useRiggerStore((s) => s.exportTarget);
  const useSymmetry           = useRiggerStore((s) => s.useSymmetry);
  const diffuseIterations     = useRiggerStore((s) => s.diffuseIterations);
  const bilateralStrength     = useRiggerStore((s) => s.bilateralStrength);
  const requiredBonesOnly     = useRiggerStore((s) => s.requiredBonesOnly);
  const includeSecondaryBones = useRiggerStore((s) => s.includeSecondaryBones);

  // Store actions
  const setMeshFile        = useRiggerStore((s) => s.setMeshFile);
  const setLandmark        = useRiggerStore((s) => s.setLandmark);
  const setLandmarkPreset  = useRiggerStore((s) => s.setLandmarkPreset);
  const clearLandmarks     = useRiggerStore((s) => s.clearLandmarks);
  const deleteLandmark     = useRiggerStore((s) => s.deleteLandmark);
  const setActiveLandmark  = useRiggerStore((s) => s.setActiveLandmark);
  const setLandmarkMode    = useRiggerStore((s) => s.setLandmarkMode);
  const setUseSymmetry     = useRiggerStore((s) => s.setUseSymmetry);
  const confirmLandmarks   = useRiggerStore((s) => s.confirmLandmarks);
  const setFitResult       = useRiggerStore((s) => s.setFitResult);
  const setRawWeights      = useRiggerStore((s) => s.setRawWeights);
  const setSmoothWeights   = useRiggerStore((s) => s.setSmoothWeights);
  const setStage           = useRiggerStore((s) => s.setStage);
  const setUiPhase         = useRiggerStore((s) => s.setUiPhase);
  const backToRig          = useRiggerStore((s) => s.backToRig);
  const setProgress        = useRiggerStore((s) => s.setProgress);
  const setError           = useRiggerStore((s) => s.setError);
  const setTestAnimation   = useRiggerStore((s) => s.setTestAnimation);
  const setCharacterName   = useRiggerStore((s) => s.setCharacterName);
  const setOption          = useRiggerStore((s) => s.setOption);
  const reset              = useRiggerStore((s) => s.reset);

  const phaseStep: 1 | 2 | 3 =
    uiPhase === 'export' ? 3 : uiPhase === 'preview' ? 2 : 1;
  const activeProfile = getEngineProfile(exportTarget);

  const activeLandmarkIds = getLandmarkIdsForPreset(landmarkPreset);
  const placedActiveCount = activeLandmarkIds.filter((id) => Boolean(landmarks[id])).length;
  const totalActiveCount  = activeLandmarkIds.length;
  const coreSet           = areAllLandmarksSet(landmarks);
  const coreCount         = LANDMARK_IDS.filter((id) => Boolean(landmarks[id])).length;
  const optionalIds       = activeLandmarkIds.filter((id) => !(LANDMARK_IDS as readonly string[]).includes(id));
  const placedOptionalCount = optionalIds.filter((id) => Boolean(landmarks[id])).length;

  const activeLandmarksMap: Partial<LandmarkMap> = {};
  for (const id of activeLandmarkIds) {
    const pos = landmarks[id];
    if (pos) activeLandmarksMap[id] = pos;
  }

  /* `validateLandmarks` blocks rigging if L/R pairs are swapped or head < ankles. */
  const landmarkWarnings = coreSet ? validateLandmarks(activeLandmarksMap as LandmarkMap) : [];
  const canRig = coreSet && landmarkWarnings.length === 0 && Boolean(meshGeometry);

  // ── File handlers ──────────────────────────────────────────────────────────
  const handleFile = (file: File) => {
    setMeshFile(file);
    if (!characterName) setCharacterName(file.name.replace(/\.[^/.]+$/, '') || 'Character');
  };
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (f) handleFile(f);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0]; if (f) handleFile(f);
  };

  // ── Auto-detect landmarks ──────────────────────────────────────────────────
  const handleAutoDetect = () => {
    if (!meshBbox) { setError('Bounding box not ready — wait for model to appear in viewport.'); return; }
    const positionBuffer = meshGeometry?.getAttribute('position')?.array as Float32Array | undefined;
    const estimated = estimateLandmarksFromBounds({
      boundingBox: meshBbox,
      positionBuffer,
      preset: landmarkPreset,
    });
    clearLandmarks();
    for (const [id, vec] of Object.entries(estimated)) {
      if (vec) setLandmark(id as LandmarkId, vec);
    }
    confirmLandmarks();
  };

  // ── Phase 1 Rig pipeline (transitions into Phase 2 Preview) ────────────────
  const handleRig = async () => {
    if (!areAllLandmarksSet(landmarks)) {
      setError('All 8 core landmark points must be placed before rigging.');
      return;
    }
    if (!meshGeometry) {
      setError('3D mesh geometry is not ready yet. Wait for the model to fully appear in the viewport.');
      return;
    }
    try {
      setStage('rigging');
      setActiveLandmark(null);
      setError(null);

      setProgress({ label: 'Fitting skeleton to landmarks…', value: 0.12 });
      const fit = fitSkeletonToLandmarks(activeLandmarksMap as LandmarkMap, {
        requiredOnly: requiredBonesOnly,
        includeSecondaryBones,
      });
      setFitResult(fit);

      setProgress({ label: 'Transferring vertex weights…', value: 0.35 });
      const raw = await transferWeightsAsync(meshGeometry, fit, new THREE.Matrix4(), {
        bilateralStrength,
        onProgress: (p) => setProgress({ label: 'Transferring vertex weights…', value: 0.35 + p * 0.35 }),
      });
      setRawWeights(raw);

      setProgress({ label: 'Smoothing joint seams…', value: 0.72 });
      const smooth = await diffuseWeightsAsync(raw, meshGeometry, {
        iterations: diffuseIterations,
        onProgress: (p) => setProgress({ label: 'Smoothing joint seams…', value: 0.72 + p * 0.28 }),
      });
      setSmoothWeights(smooth);

      setProgress(null);
      setStage('done');
      setTestAnimation('idle');
      setUiPhase('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage('error');
      setProgress(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-100 select-none overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-3 border-b border-zinc-800 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
            <span className="text-base">🦴</span>
            <span>Auto-Rigger Studio</span>
            <span className="text-[10px] font-normal text-zinc-300 bg-zinc-800 px-1.5 py-0.5 rounded">
              {activeProfile.badgeText}
            </span>
          </h1>
          <p className="text-[10px] text-zinc-500 mt-0.5">Rig → Preview → Export (GLB &amp; FBX)</p>
        </div>
        <a
          href="/"
          className="min-h-[26px] inline-flex items-center text-[10px] text-zinc-400 hover:text-zinc-200 bg-zinc-900 border border-zinc-800 px-2 py-1 rounded-md no-underline transition-colors"
        >
          ← Creator
        </a>
      </div>

      {/* ── 3-Phase Step Bar (Rig → Preview → Export) ──────────────────────── */}
      <div className="px-3 py-3 border-b border-zinc-800 flex-shrink-0">
        <RiggerStepBar step={phaseStep} />
      </div>

      {/* ── Scrollable body ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto scrollbar-none flex flex-col gap-3 p-4">

        {/* ── Error banner ─────────────────────────────────────────────────── */}
        {error && (
          <div className="bg-red-950/80 border border-red-800 text-red-200 p-3 rounded-xl flex flex-col gap-1">
            <div className="font-semibold text-[11px] flex items-center gap-1.5">⚠️ Error</div>
            <div className="text-[10px] leading-tight">{error}</div>
            <button
              type="button"
              onClick={() => setError(null)}
              className="self-end min-h-[24px] px-1 text-[10px] text-red-400 underline hover:text-white mt-0.5"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            PHASE 1 — Upload + Place Markers + Rig Settings
        ════════════════════════════════════════════════════════════════════ */}
        {uiPhase === 'rig' && (
          <>
            {/* Upload card */}
            <div className={`rounded-xl border transition-all ${
              stage === 'idle' ? 'border-sky-500/40 bg-sky-950/10' : 'border-zinc-800 bg-zinc-900/40'
            }`}>
              <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-sky-300">
                  1 · Model
                </span>
                {meshFile && (
                  <span className="ml-auto text-[10px] text-emerald-400 font-medium truncate max-w-[160px]">
                    {meshFile.name}
                  </span>
                )}
              </div>

              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`mx-3 mb-3 border-2 border-dashed rounded-xl ${meshFile ? 'p-2.5' : 'p-4'} text-center cursor-pointer transition-all ${
                  meshFile ? 'border-emerald-500/50 bg-emerald-950/20' : 'border-zinc-700 hover:border-zinc-500 bg-zinc-900/50'
                }`}
              >
                <input ref={fileInputRef} type="file" accept=".glb,.gltf,.obj" onChange={handleFileChange} className="hidden" />
                {meshFile ? (
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-lg">📦</span>
                    <div className="text-[10px] text-zinc-400">
                      {(meshFile.size / 1024 / 1024).toFixed(2)} MB · Click or drop to replace
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-1.5">
                    <span className="text-3xl text-zinc-500">📥</span>
                    <div className="font-semibold text-zinc-300 text-xs">Drop Humanoid Mesh Here</div>
                    <div className="text-[10px] text-zinc-500">GLB, GLTF or OBJ</div>
                  </div>
                )}
              </div>
            </div>

            {/* Place Markers */}
            {stage !== 'idle' && (
              <div className="rounded-xl border border-sky-500/40 bg-sky-950/10 transition-all">
                <div className="flex items-center gap-2 px-3 pt-3 pb-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-sky-300">
                    2 · Place Markers
                  </span>
                  <span
                    className={`ml-auto text-[10px] font-mono font-bold ${
                      coreSet && placedActiveCount === totalActiveCount
                        ? 'text-emerald-400'
                        : coreSet
                        ? 'text-sky-300'
                        : 'text-zinc-400'
                    }`}
                  >
                    {placedActiveCount}/{totalActiveCount}
                  </span>
                </div>

                <div className="px-3 pb-3 flex flex-col gap-2.5">
                  {/* Landmark count preset selector */}
                  <div className="flex bg-zinc-900 rounded-lg p-0.5 text-[10px] border border-zinc-800">
                    {([
                      ['8', '8 Core'],
                      ['14', '14 Limbs'],
                      ['16', '16 + Detail'],
                    ] as [LandmarkPreset, string][]).map(([preset, label]) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setLandmarkPreset(preset)}
                        className={`flex-1 min-h-[26px] py-1 px-1.5 rounded-md transition-colors font-medium ${
                          landmarkPreset === preset
                            ? 'bg-zinc-700 text-white shadow-sm'
                            : 'text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* Mode toggle */}
                  <div className="flex bg-zinc-900 rounded-lg p-0.5 text-[10px] border border-zinc-800">
                    <button
                      type="button"
                      onClick={() => setLandmarkMode('auto')}
                      className={`flex-1 min-h-[26px] py-1 rounded-md transition-colors font-medium ${landmarkMode === 'auto' ? 'bg-sky-500 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
                    >
                      ⚡ Auto-Detect
                    </button>
                    <button
                      type="button"
                      onClick={() => setLandmarkMode('manual')}
                      className={`flex-1 min-h-[26px] py-1 rounded-md transition-colors font-medium ${landmarkMode === 'manual' ? 'bg-sky-500 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
                    >
                      🎯 Manual
                    </button>
                  </div>

                  {/* Symmetry Toggle */}
                  <label className="min-h-[28px] flex items-center justify-between cursor-pointer bg-zinc-900/50 hover:bg-zinc-900 px-2.5 py-1.5 rounded-lg border border-zinc-800 transition-colors">
                    <span className="text-[10px] text-zinc-300 flex items-center gap-1.5">
                      <span>🪞</span> Use Symmetry (mirror L/R)
                    </span>
                    <input
                      type="checkbox"
                      checked={useSymmetry}
                      onChange={(e) => setUseSymmetry(e.target.checked)}
                      className="accent-sky-500 h-3.5 w-3.5 rounded"
                    />
                  </label>

                  {landmarkMode === 'auto' ? (
                    <div className="flex flex-col gap-2">
                      <p className="text-[10px] text-zinc-400 leading-relaxed">
                        Estimates {totalActiveCount} anatomical points (
                        {landmarkPreset === '8'
                          ? 'core joints'
                          : landmarkPreset === '14'
                          ? 'core + elbows, wrists & knees'
                          : 'core, limbs + chin & groin'}
                        ) from mesh geometry and symmetry.
                      </p>
                      <button
                        type="button"
                        onClick={handleAutoDetect}
                        className="w-full min-h-[34px] py-2 px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
                      >
                        ⚡ Auto-Detect All Markers
                      </button>
                      {placedActiveCount > 0 && (
                        <button
                          type="button"
                          onClick={clearLandmarks}
                          className="w-full min-h-[26px] py-1 rounded-lg text-[10px] text-zinc-400 hover:text-zinc-200 bg-zinc-900 border border-zinc-800 transition-colors"
                        >
                          Clear &amp; Re-detect
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="text-[10px] text-zinc-400">
                      Select a marker, then <strong className="text-zinc-200">click on the mesh</strong> to place it. Drag placed markers to adjust.
                    </p>
                  )}

                  {/* Landmark grid */}
                  <div className="grid grid-cols-2 gap-1">
                    {activeLandmarkIds.map((id) => {
                      const isSet    = Boolean(landmarks[id]);
                      const isActive = activeLandmark === id;
                      const meta     = LANDMARK_META[id];
                      const isCore   = (LANDMARK_IDS as readonly string[]).includes(id);
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setActiveLandmark(isActive ? null : id)}
                          title={`${meta.label}${isCore ? ' (Required core)' : ' (Optional precision)'}`}
                          className={`min-h-[28px] py-1 px-1.5 rounded-lg text-left text-[10px] flex items-center gap-1 border transition-all ${
                            isActive
                              ? 'border-sky-400 bg-sky-950/50 text-sky-200 shadow-[0_0_8px_rgba(14,165,233,0.3)] font-semibold'
                              : isSet
                              ? 'border-zinc-700 bg-zinc-800/60 text-zinc-200'
                              : 'border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:border-zinc-700 hover:text-zinc-400'
                          }`}
                        >
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ background: meta.color, boxShadow: isSet ? `0 0 4px ${meta.color}` : 'none' }}
                          />
                          <span className="truncate">{meta.label}</span>
                          {isSet ? (
                            <span
                              role="button"
                              tabIndex={0}
                              aria-label={`Remove ${meta.label}`}
                              title={`Remove ${meta.label}`}
                              onClick={(ev) => { ev.stopPropagation(); deleteLandmark(id); }}
                              onKeyDown={(ev) => {
                                if (ev.key === 'Enter' || ev.key === ' ') {
                                  ev.preventDefault();
                                  ev.stopPropagation();
                                  deleteLandmark(id);
                                }
                              }}
                              className="ml-auto flex-shrink-0 min-w-[24px] min-h-[24px] flex items-center justify-center rounded text-[11px] text-zinc-400 hover:bg-red-950/60 hover:text-red-300"
                            >
                              ×
                            </span>
                          ) : (
                            <span className="ml-auto flex-shrink-0 px-1 text-[10px]">
                              {isActive ? '●' : isCore ? '○' : '+'}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {optionalIds.length > 0 && (
                    <div className="flex items-center justify-between text-[10px] text-zinc-400 px-0.5">
                      <span>
                        Core:{' '}
                        <strong className={coreSet ? 'text-emerald-400' : 'text-zinc-300'}>
                          {coreCount}/8
                        </strong>
                      </span>
                      <span>
                        Optional:{' '}
                        <strong className={placedOptionalCount === optionalIds.length ? 'text-sky-300' : 'text-zinc-300'}>
                          {placedOptionalCount}/{optionalIds.length}
                        </strong>
                      </span>
                    </div>
                  )}

                  {landmarkMode === 'manual' && (
                    <div className="flex gap-1.5 mt-0.5">
                      <button
                        type="button"
                        onClick={clearLandmarks}
                        className="flex-1 min-h-[28px] py-1 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 text-[10px]"
                      >
                        Clear All
                      </button>
                      <button
                        type="button"
                        disabled={!coreSet}
                        onClick={confirmLandmarks}
                        className={`flex-1 min-h-[28px] py-1 rounded-lg text-[10px] font-semibold transition-colors ${
                          coreSet ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                        }`}
                      >
                        Confirm ({placedActiveCount}/{totalActiveCount})
                      </button>
                    </div>
                  )}

                  {landmarkWarnings.length > 0 && (
                    <ul className="mt-1 flex flex-col gap-1 rounded-lg border border-amber-700/40 bg-amber-950/20 px-2 py-1.5">
                      {landmarkWarnings.map((w) => (
                        <li key={w} className="text-[10px] leading-snug text-amber-300">⚠ {w}</li>
                      ))}
                    </ul>
                  )}

                  {/* Progress dots */}
                  <div className="flex gap-1 mt-0.5">
                    {activeLandmarkIds.map((id) => (
                      <div
                        key={id}
                        title={LANDMARK_META[id].label}
                        className="flex-1 h-1 rounded-full transition-all"
                        style={{ background: landmarks[id] ? LANDMARK_META[id].color : '#3f3f46' }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Rig Options (no animation preview bar here — clean Phase 1) */}
            {stage !== 'idle' && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 flex flex-col gap-2.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
                  3 · Rig Options
                </span>

                <TargetEngineSelector variant="compact" />

                <div className="flex flex-col gap-1 border-t border-zinc-800 pt-2">
                  <label className="text-[10px] text-zinc-400">Character Name</label>
                  <input
                    type="text"
                    value={characterName}
                    onChange={(e) => setCharacterName(e.target.value)}
                    placeholder="Character"
                    className="min-h-[30px] bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-zinc-100 text-xs focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div className="border-t border-zinc-800 pt-2 flex flex-col gap-1.5">
                  <label className="min-h-[24px] flex items-center justify-between cursor-pointer">
                    <span className="text-[10px] text-zinc-300">Required Bones Only (22)</span>
                    <input
                      type="checkbox"
                      checked={requiredBonesOnly}
                      onChange={(e) => setOption('requiredBonesOnly', e.target.checked)}
                      className="accent-sky-500 h-3.5 w-3.5"
                    />
                  </label>
                  <label
                    className={`min-h-[24px] flex items-center justify-between ${requiredBonesOnly ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    title={
                      requiredBonesOnly
                        ? 'Disable "Required Bones Only" to include custom secondary bones'
                        : 'Adds custom pelvisLower, glute, and chest helper bones'
                    }
                  >
                    <span className="text-[10px] text-zinc-300 flex items-center gap-1.5">
                      <span>Pelvis / Glutes &amp; Chest</span>
                      <span className="text-[10px] text-zinc-500 bg-zinc-800/80 px-1.5 py-0.5 rounded">Custom</span>
                    </span>
                    <input
                      type="checkbox"
                      disabled={requiredBonesOnly}
                      checked={includeSecondaryBones && !requiredBonesOnly}
                      onChange={(e) => setOption('includeSecondaryBones', e.target.checked)}
                      className="accent-sky-500 h-3.5 w-3.5"
                    />
                  </label>
                </div>

                <div className="border-t border-zinc-800 pt-2 flex flex-col gap-2">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-zinc-300">Diffusion Passes</span>
                    <span className="font-mono text-zinc-400">{diffuseIterations}</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={8}
                    value={diffuseIterations}
                    onChange={(e) => setOption('diffuseIterations', Number(e.target.value))}
                    className="accent-sky-500 h-1 bg-zinc-700 rounded-lg cursor-pointer"
                  />

                  <div className="flex justify-between text-[10px] mt-1">
                    <span className="text-zinc-300">Bilateral Symmetry</span>
                    <span className="font-mono text-zinc-400">{(bilateralStrength * 100).toFixed(0)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={bilateralStrength}
                    onChange={(e) => setOption('bilateralStrength', Number(e.target.value))}
                    className="accent-sky-500 h-1 bg-zinc-700 rounded-lg cursor-pointer"
                  />
                </div>
              </div>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            PHASE 3 — Export Panel (GLB & FBX)
        ════════════════════════════════════════════════════════════════════ */}
        {uiPhase === 'export' && <ExportPanel />}

        {/* ── Progress bar ─────────────────────────────────────────────────── */}
        {progress && (
          <div className="bg-zinc-900 border border-sky-500/30 p-3 rounded-xl flex flex-col gap-2">
            <div className="flex justify-between text-sky-300 font-medium text-[11px]">
              <span>{progress.label}</span>
              <span>{(progress.value * 100).toFixed(0)}%</span>
            </div>
            <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-sky-500 h-full rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(0, progress.value * 100))}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Sticky action footer ───────────────────────────────────────────── */}
      <div className="flex-shrink-0 p-4 pt-2 border-t border-zinc-800/70 flex flex-col gap-2">
        {uiPhase === 'rig' && stage !== 'idle' && (
          <button
            type="button"
            disabled={!canRig || stage === 'rigging'}
            onClick={handleRig}
            className={`w-full min-h-[42px] py-2.5 px-4 rounded-xl font-bold text-sm shadow-lg flex items-center justify-center gap-2 transition-all ${
              stage === 'rigging'
                ? 'bg-sky-600/80 text-white cursor-wait animate-pulse'
                : canRig
                ? 'bg-sky-500 hover:bg-sky-400 text-white shadow-sky-900/40 cursor-pointer active:scale-[0.98]'
                : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
            }`}
          >
            <span>{stage === 'rigging' ? '⚙️' : '▶'}</span>
            <span>
              {stage === 'rigging'
                ? 'Auto-Rigging…'
                : !coreSet
                ? `Place ${LANDMARK_IDS.length - coreCount} Core Marker${LANDMARK_IDS.length - coreCount !== 1 ? 's' : ''}`
                : landmarkWarnings.length > 0
                ? 'Fix Landmark Warnings'
                : !meshGeometry
                ? 'Loading mesh…'
                : 'Rig Character'}
            </span>
          </button>
        )}

        {uiPhase === 'export' && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setUiPhase('preview')}
                className="min-h-[34px] py-2 px-3 rounded-xl text-xs font-medium text-zinc-200 hover:text-white bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 transition-colors"
              >
                ← Preview
              </button>
              <button
                type="button"
                onClick={backToRig}
                className="min-h-[34px] py-2 px-3 rounded-xl text-xs font-medium text-zinc-300 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 transition-colors"
              >
                ✎ Edit Markers
              </button>
            </div>
            <button
              type="button"
              onClick={reset}
              className="w-full min-h-[34px] py-2 px-4 rounded-xl text-xs text-zinc-400 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 transition-colors"
            >
              ↩ Start Over with New Model
            </button>
          </>
        )}
      </div>
    </div>
  );
}
