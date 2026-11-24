'use client';

import * as THREE from 'three';
import { useRef, useState } from 'react';
import { useRiggerStore, areAllLandmarksSet } from '@/lib/rigger/store';
import { LANDMARK_IDS, type LandmarkId, type LandmarkMap } from '@/lib/rigger/vrmSkeleton';
import { LANDMARK_META } from '@/components/rigger/LandmarkEditor';
import { fitSkeletonToLandmarks, estimateLandmarksFromBounds, validateLandmarks } from '@/lib/rigger/templateFitter';
import { transferWeightsAsync } from '@/lib/rigger/weightTransfer';
import { diffuseWeightsAsync } from '@/lib/rigger/heatDiffusion';
import { exportRiggedGlb, exportSummary } from '@/lib/rigger/exportRiggedGlb';

/* Order comes from `vrmSkeleton.ts` so it matches the auto-advance sequence. */
const ORDERED_LANDMARKS: readonly LandmarkId[] = LANDMARK_IDS;

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

function StepBar({ step }: { step: 1 | 2 | 3 }) {
  const steps = ['Upload', 'Place Markers', 'Rig & Export'];
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
              <span className={`text-[9px] font-medium truncate max-w-[52px] text-center ${
                active ? 'text-sky-300' : done ? 'text-emerald-400' : 'text-zinc-600'
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
  const stage              = useRiggerStore((s) => s.stage);
  const meshFile           = useRiggerStore((s) => s.meshFile);
  const meshGeometry       = useRiggerStore((s) => s.meshGeometry);
  const meshBbox           = useRiggerStore((s) => s.meshBbox);
  const landmarks          = useRiggerStore((s) => s.landmarks);
  const landmarkMode       = useRiggerStore((s) => s.landmarkMode);
  const activeLandmark     = useRiggerStore((s) => s.activeLandmark);
  const fitResult          = useRiggerStore((s) => s.fitResult);
  const smoothWeights      = useRiggerStore((s) => s.smoothWeights);
  const progress           = useRiggerStore((s) => s.progress);
  const error              = useRiggerStore((s) => s.error);
  const showSkeleton       = useRiggerStore((s) => s.showSkeleton);
  const showWeightMap      = useRiggerStore((s) => s.showWeightMap);
  const characterName      = useRiggerStore((s) => s.characterName);
  const useSymmetry        = useRiggerStore((s) => s.useSymmetry);
  const includeVrm         = useRiggerStore((s) => s.includeVrm);
  const diffuseIterations  = useRiggerStore((s) => s.diffuseIterations);
  const bilateralStrength  = useRiggerStore((s) => s.bilateralStrength);
  const requiredBonesOnly  = useRiggerStore((s) => s.requiredBonesOnly);

  // Store actions
  const setMeshFile        = useRiggerStore((s) => s.setMeshFile);
  const setLandmark        = useRiggerStore((s) => s.setLandmark);
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
  const setProgress        = useRiggerStore((s) => s.setProgress);
  const setError           = useRiggerStore((s) => s.setError);
  const toggleSkeleton     = useRiggerStore((s) => s.toggleSkeleton);
  const toggleWeightMap    = useRiggerStore((s) => s.toggleWeightMap);
  const setCharacterName   = useRiggerStore((s) => s.setCharacterName);
  const setOption          = useRiggerStore((s) => s.setOption);
  const reset              = useRiggerStore((s) => s.reset);

  const [lastExportBuffer, setLastExportBuffer] = useState<ArrayBuffer | null>(null);
  const [summaryText, setSummaryText] = useState<string | null>(null);

  // ── Wizard step ────────────────────────────────────────────────────────────
  const wizardStep: 1 | 2 | 3 =
    stage === 'idle'   ? 1 :
    stage === 'done'   ? 3 :
    stage === 'rigging'? 3 : 2;

  const landmarkCount = Object.keys(landmarks).length;
  const allSet = areAllLandmarksSet(landmarks);
  /* `validateLandmarks` was written but never called, so a swapped left/right
     pair rigged a mangled character with no warning. Block on it instead. */
  const landmarkWarnings = allSet ? validateLandmarks(landmarks as LandmarkMap) : [];
  const canRig = allSet && landmarkWarnings.length === 0 && Boolean(meshGeometry);

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
    const estimated = estimateLandmarksFromBounds({ boundingBox: meshBbox });
    for (const [id, vec] of Object.entries(estimated)) {
      setLandmark(id as LandmarkId, vec);
    }
    confirmLandmarks();
  };

  // ── Full rig pipeline ──────────────────────────────────────────────────────
  const handleRig = async () => {
    if (!areAllLandmarksSet(landmarks)) {
      setError('All 8 landmark points must be placed before rigging.');
      return;
    }
    if (!meshGeometry) {
      setError('3D mesh geometry is not ready yet. Wait for the model to fully appear in the viewport.');
      return;
    }
    try {
      setStage('rigging');
      setError(null);

      setProgress({ label: 'Fitting skeleton to landmarks…', value: 0.1 });
      const fit = fitSkeletonToLandmarks(landmarks as LandmarkMap, { requiredOnly: requiredBonesOnly });
      setFitResult(fit);

      setProgress({ label: 'Transferring vertex weights…', value: 0.3 });
      const raw = await transferWeightsAsync(meshGeometry, fit, new THREE.Matrix4(), {
        bilateralStrength,
        onProgress: (p) => setProgress({ label: 'Transferring vertex weights…', value: 0.3 + p * 0.3 }),
      });
      setRawWeights(raw);

      setProgress({ label: 'Applying Laplacian diffusion smoothing…', value: 0.65 });
      const smooth = await diffuseWeightsAsync(raw, meshGeometry, {
        iterations: diffuseIterations,
        onProgress: (p) => setProgress({ label: 'Smoothing joint seams…', value: 0.65 + p * 0.2 }),
      });
      setSmoothWeights(smooth);

      setProgress({ label: 'Packing rigged GLB…', value: 0.9 });
      const defaultMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.5, metalness: 0 });
      const buffer = await exportRiggedGlb(meshGeometry, defaultMat, fit, smooth, {
        name: characterName || 'Character',
        includeVrmExtension: includeVrm,
        download: true,
      });
      setLastExportBuffer(buffer);
      setSummaryText(exportSummary(fit, smooth, buffer.byteLength, characterName || 'Character'));

      setProgress(null);
      setStage('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage('error');
      setProgress(null);
    }
  };

  // ── Re-download ────────────────────────────────────────────────────────────
  const handleReDownload = () => {
    if (!lastExportBuffer) return;
    const blob = new Blob([lastExportBuffer], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${characterName || 'Character'}_rigged.glb`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-100 select-none overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-3 border-b border-zinc-800 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
            <span className="text-base">🦴</span>
            <span>Auto-Rigger Studio</span>
            <span className="text-[9px] font-normal text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">VRM 1.0</span>
          </h1>
          <p className="text-[10px] text-zinc-500 mt-0.5">Open standards · No Blender plugin needed</p>
        </div>
        <a
          href="/"
          className="text-[10px] text-zinc-400 hover:text-zinc-200 bg-zinc-900 border border-zinc-800 px-2 py-1 rounded-md no-underline transition-colors"
        >
          ← Creator
        </a>
      </div>

      {/* ── Step bar ───────────────────────────────────────────────────────── */}
      <div className="px-3 py-3 border-b border-zinc-800 flex-shrink-0">
        <StepBar step={wizardStep} />
      </div>

      {/* ── Scrollable body ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto scrollbar-none flex flex-col gap-3 p-4">

        {/* ── Error banner ─────────────────────────────────────────────────── */}
        {error && (
          <div className="bg-red-950/80 border border-red-800 text-red-200 p-3 rounded-xl flex flex-col gap-1">
            <div className="font-semibold text-[11px] flex items-center gap-1.5">⚠️ Error</div>
            <div className="text-[10px] leading-tight">{error}</div>
            <button onClick={() => setError(null)} className="self-end text-[10px] text-red-400 underline hover:text-white mt-0.5">
              Dismiss
            </button>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            STEP 1 — Upload
        ════════════════════════════════════════════════════════════════════ */}
        <div className={`rounded-xl border transition-all ${
          wizardStep === 1 ? 'border-sky-500/40 bg-sky-950/10' : 'border-zinc-800 bg-zinc-900/40'
        }`}>
          <div className="flex items-center gap-2 px-3 pt-3 pb-2">
            <StepDot n={1} active={wizardStep === 1} done={wizardStep > 1} />
            <span className={`text-[11px] font-semibold uppercase tracking-wider ${wizardStep === 1 ? 'text-sky-300' : wizardStep > 1 ? 'text-emerald-400' : 'text-zinc-500'}`}>
              Upload Model
            </span>
          </div>

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`mx-3 mb-3 border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${
              meshFile ? 'border-emerald-500/50 bg-emerald-950/20' : 'border-zinc-700 hover:border-zinc-500 bg-zinc-900/50'
            }`}
          >
            <input ref={fileInputRef} type="file" accept=".glb,.gltf,.obj" onChange={handleFileChange} className="hidden" />
            {meshFile ? (
              <div className="flex flex-col items-center gap-1">
                <span className="text-2xl">📦</span>
                <div className="font-medium text-emerald-400 text-xs truncate max-w-[180px]">{meshFile.name}</div>
                <div className="text-[10px] text-zinc-500">{(meshFile.size / 1024 / 1024).toFixed(2)} MB · Click to change</div>
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

        {/* ══════════════════════════════════════════════════════════════════
            STEP 2 — Place Markers
        ════════════════════════════════════════════════════════════════════ */}
        {stage !== 'idle' && (
          <div className={`rounded-xl border transition-all ${
            wizardStep === 2 ? 'border-sky-500/40 bg-sky-950/10' : 'border-zinc-800 bg-zinc-900/40'
          }`}>
            <div className="flex items-center gap-2 px-3 pt-3 pb-2">
              <StepDot n={2} active={wizardStep === 2} done={wizardStep > 2} />
              <span className={`text-[11px] font-semibold uppercase tracking-wider ${wizardStep === 2 ? 'text-sky-300' : wizardStep > 2 ? 'text-emerald-400' : 'text-zinc-500'}`}>
                Place Markers
              </span>
              <span className="ml-auto text-[10px] font-mono font-bold text-zinc-400">
                {landmarkCount}/8
              </span>
            </div>

            <div className="px-3 pb-3 flex flex-col gap-2.5">
              {/* Mode toggle */}
              <div className="flex bg-zinc-900 rounded-lg p-0.5 text-[10px] border border-zinc-800">
                <button
                  onClick={() => setLandmarkMode('auto')}
                  className={`flex-1 py-1 rounded-md transition-colors font-medium ${landmarkMode === 'auto' ? 'bg-sky-500 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                  ⚡ Auto-Detect
                </button>
                <button
                  onClick={() => setLandmarkMode('manual')}
                  className={`flex-1 py-1 rounded-md transition-colors font-medium ${landmarkMode === 'manual' ? 'bg-sky-500 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                  🎯 Manual
                </button>
              </div>

              {/* Symmetry Toggle (Mixamo style) */}
              <label className="flex items-center justify-between cursor-pointer bg-zinc-900/50 hover:bg-zinc-900 px-2.5 py-1.5 rounded-lg border border-zinc-800 transition-colors">
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
                    Estimates all 8 anatomical points from mesh height and symmetry. Click individual markers in the viewport to fine-tune.
                  </p>
                  <button
                    onClick={handleAutoDetect}
                    className="w-full py-2 px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
                  >
                    ⚡ Auto-Detect All Markers
                  </button>
                  {landmarkCount > 0 && (
                    <button
                      onClick={clearLandmarks}
                      className="w-full py-1 rounded-lg text-[10px] text-zinc-500 hover:text-zinc-300 bg-zinc-900 border border-zinc-800 transition-colors"
                    >
                      Clear & Re-detect
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-[10px] text-zinc-400">
                    Select a marker, then <strong className="text-zinc-200">click on the mesh</strong> to place it. Drag placed markers to adjust.
                  </p>

                  {/* Landmark grid — Mixamo style */}
                  <div className="grid grid-cols-2 gap-1">
                    {ORDERED_LANDMARKS.map((id) => {
                      const isSet    = Boolean(landmarks[id]);
                      const isActive = activeLandmark === id;
                      const meta     = LANDMARK_META[id];
                      return (
                        <button
                          key={id}
                          onClick={() => setActiveLandmark(isActive ? null : id)}
                          className={`py-1.5 px-2 rounded-lg text-left text-[10px] flex items-center gap-1.5 border transition-all ${
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
                              className="ml-auto flex-shrink-0 rounded px-1 text-[11px] text-zinc-400 hover:bg-red-950/60 hover:text-red-300"
                            >
                              ×
                            </span>
                          ) : (
                            <span className="ml-auto flex-shrink-0">{isActive ? '●' : '○'}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex gap-1.5 mt-0.5">
                    <button
                      onClick={clearLandmarks}
                      className="flex-1 py-1 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 text-[10px]"
                    >
                      Clear All
                    </button>
                    <button
                      disabled={!allSet}
                      onClick={confirmLandmarks}
                      className={`flex-1 py-1 rounded-lg text-[10px] font-semibold transition-colors ${
                        allSet ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                      }`}
                    >
                      Confirm (8/8)
                    </button>
                  </div>
                </div>
              )}

              {/* Validation: previously `validateLandmarks` was never called,
                  so a swapped L/R pair rigged a mangled character silently. */}
              {landmarkWarnings.length > 0 && (
                <ul className="mt-1 flex flex-col gap-1 rounded-lg border border-amber-700/40 bg-amber-950/20 px-2 py-1.5">
                  {landmarkWarnings.map((w) => (
                    <li key={w} className="text-[10px] leading-snug text-amber-300">⚠ {w}</li>
                  ))}
                </ul>
              )}

              {/* Progress dots */}
              <div className="flex gap-1 mt-0.5">
                {ORDERED_LANDMARKS.map((id) => (
                  <div
                    key={id}
                    className="flex-1 h-1 rounded-full transition-all"
                    style={{ background: landmarks[id] ? LANDMARK_META[id].color : '#3f3f46' }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            STEP 3 — Rig Options + Export
        ════════════════════════════════════════════════════════════════════ */}
        {stage !== 'idle' && (
          <div className={`rounded-xl border transition-all ${
            wizardStep === 3 ? 'border-sky-500/40 bg-sky-950/10' : 'border-zinc-800 bg-zinc-900/40'
          }`}>
            <div className="flex items-center gap-2 px-3 pt-3 pb-2">
              <StepDot n={3} active={wizardStep === 3} done={stage === 'done'} />
              <span className={`text-[11px] font-semibold uppercase tracking-wider ${wizardStep === 3 ? 'text-sky-300' : stage === 'done' ? 'text-emerald-400' : 'text-zinc-500'}`}>
                Rig &amp; Export
              </span>
            </div>

            <div className="px-3 pb-3 flex flex-col gap-2.5">
              {/* Character name */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-zinc-400">Character Name</label>
                <input
                  type="text"
                  value={characterName}
                  onChange={(e) => setCharacterName(e.target.value)}
                  placeholder="Character"
                  className="bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-zinc-100 text-xs focus:outline-none focus:border-sky-500"
                />
              </div>

              {/* Rig options */}
              <div className="border-t border-zinc-800 pt-2 flex flex-col gap-2">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-[10px] text-zinc-300">VRM 1.0 Metadata</span>
                  <input type="checkbox" checked={includeVrm} onChange={(e) => setOption('includeVrm', e.target.checked)} className="accent-sky-500 h-3.5 w-3.5" />
                </label>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-[10px] text-zinc-300">Required Bones Only (22)</span>
                  <input type="checkbox" checked={requiredBonesOnly} onChange={(e) => setOption('requiredBonesOnly', e.target.checked)} className="accent-sky-500 h-3.5 w-3.5" />
                </label>
              </div>

              {/* Sliders */}
              <div className="border-t border-zinc-800 pt-2 flex flex-col gap-2">
                <div className="flex justify-between text-[10px]">
                  <span className="text-zinc-300">Diffusion Passes</span>
                  <span className="font-mono text-zinc-400">{diffuseIterations}</span>
                </div>
                <input type="range" min={1} max={8} value={diffuseIterations} onChange={(e) => setOption('diffuseIterations', Number(e.target.value))} className="accent-sky-500 h-1 bg-zinc-700 rounded-lg cursor-pointer" />

                <div className="flex justify-between text-[10px] mt-1">
                  <span className="text-zinc-300">Bilateral Symmetry</span>
                  <span className="font-mono text-zinc-400">{(bilateralStrength * 100).toFixed(0)}%</span>
                </div>
                <input type="range" min={0} max={1} step={0.05} value={bilateralStrength} onChange={(e) => setOption('bilateralStrength', Number(e.target.value))} className="accent-sky-500 h-1 bg-zinc-700 rounded-lg cursor-pointer" />
              </div>

              {/* Viewport overlays */}
              <div className="border-t border-zinc-800 pt-2 grid grid-cols-2 gap-1.5">
                <button
                  onClick={toggleSkeleton}
                  disabled={!fitResult}
                  className={`py-1.5 px-2 rounded-lg border text-center text-[10px] transition-colors ${
                    fitResult && showSkeleton ? 'border-sky-500/60 bg-sky-950/40 text-sky-300 font-medium' : 'border-zinc-800 bg-zinc-800/40 text-zinc-500'
                  }`}
                >
                  🦴 Skeleton {fitResult && showSkeleton ? 'ON' : 'OFF'}
                </button>
                <button
                  onClick={toggleWeightMap}
                  disabled={!smoothWeights}
                  className={`py-1.5 px-2 rounded-lg border text-center text-[10px] transition-colors ${
                    smoothWeights && showWeightMap ? 'border-sky-500/60 bg-sky-950/40 text-sky-300 font-medium' : 'border-zinc-800 bg-zinc-800/40 text-zinc-500'
                  }`}
                >
                  🎨 Weights {smoothWeights && showWeightMap ? 'ON' : 'OFF'}
                </button>
              </div>
            </div>
          </div>
        )}

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

        {/* ── Done: summary + re-download ──────────────────────────────────── */}
        {stage === 'done' && (
          <div className="bg-emerald-950/60 border border-emerald-800 text-emerald-200 p-3 rounded-xl flex flex-col gap-2">
            <div className="font-bold text-xs text-emerald-300 flex items-center gap-1.5">
              🎉 Rig Completed!
              <span className="text-[10px] font-normal text-emerald-500 ml-auto">GLB downloaded</span>
            </div>
            {summaryText && (
              <pre className="text-[10px] text-emerald-400/90 font-mono whitespace-pre-wrap leading-tight border-t border-emerald-900 pt-2 mt-1">
                {summaryText}
              </pre>
            )}
            <button
              onClick={handleReDownload}
              disabled={!lastExportBuffer}
              className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold mt-1 flex items-center justify-center gap-1.5 transition-colors"
            >
              ⬇ Download Again
            </button>
          </div>
        )}
      </div>

      {/* ── Sticky action footer ───────────────────────────────────────────── */}
      <div className="flex-shrink-0 p-4 pt-0 flex flex-col gap-2">
        {stage !== 'done' && stage !== 'idle' && (
          <button
            disabled={!canRig || stage === 'rigging'}
            onClick={handleRig}
            className={`w-full py-3 px-4 rounded-xl font-bold text-sm shadow-lg flex items-center justify-center gap-2 transition-all ${
              stage === 'rigging'
                ? 'bg-sky-600/80 text-white cursor-wait animate-pulse'
                : canRig
                ? 'bg-sky-500 hover:bg-sky-400 text-white shadow-sky-900/40 cursor-pointer active:scale-[0.98]'
                : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
            }`}
          >
            <span>{stage === 'rigging' ? '⚙️' : '🚀'}</span>
            <span>
              {stage === 'rigging'
                ? 'Auto-Rigging…'
                : !allSet
                ? `Place ${8 - landmarkCount} More Marker${8 - landmarkCount !== 1 ? 's' : ''}`
                : !meshGeometry
                ? 'Loading mesh…'
                : 'Rig & Export Character'}
            </span>
          </button>
        )}

        {stage === 'done' && (
          <button
            onClick={reset}
            className="w-full py-2.5 px-4 rounded-xl text-xs text-zinc-400 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 transition-colors"
          >
            ↩ Start Over with New Model
          </button>
        )}
      </div>
    </div>
  );
}
