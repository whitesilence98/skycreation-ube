'use client';

import * as THREE from 'three';
import { useRef, useState } from 'react';
import { useRiggerStore, areAllLandmarksSet } from '@/lib/rigger/store';
import type { LandmarkId, LandmarkMap } from '@/lib/rigger/vrmSkeleton';
import { fitSkeletonToLandmarks, estimateLandmarksFromBounds } from '@/lib/rigger/templateFitter';
import { transferWeightsAsync } from '@/lib/rigger/weightTransfer';
import { diffuseWeightsAsync } from '@/lib/rigger/heatDiffusion';
import { exportRiggedGlb, exportSummary } from '@/lib/rigger/exportRiggedGlb';

const LANDMARK_LABELS: Record<LandmarkId, string> = {
  headTop:       'Crown / Head Top',
  neckBase:      'Neck Base (C7)',
  leftShoulder:  'Left Shoulder',
  rightShoulder: 'Right Shoulder',
  leftHip:       'Left Hip Socket',
  rightHip:      'Right Hip Socket',
  leftAnkle:     'Left Ankle',
  rightAnkle:    'Right Ankle',
};

const ORDERED_LANDMARKS: LandmarkId[] = [
  'headTop',
  'neckBase',
  'leftShoulder',
  'rightShoulder',
  'leftHip',
  'rightHip',
  'leftAnkle',
  'rightAnkle',
];

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
  const landmarksConfirmed = useRiggerStore((s) => s.landmarksConfirmed);
  const fitResult          = useRiggerStore((s) => s.fitResult);
  const smoothWeights      = useRiggerStore((s) => s.smoothWeights);
  const progress           = useRiggerStore((s) => s.progress);
  const error              = useRiggerStore((s) => s.error);
  const showSkeleton       = useRiggerStore((s) => s.showSkeleton);
  const showWeightMap      = useRiggerStore((s) => s.showWeightMap);
  const characterName      = useRiggerStore((s) => s.characterName);
  const includeVrm         = useRiggerStore((s) => s.includeVrm);
  const diffuseIterations  = useRiggerStore((s) => s.diffuseIterations);
  const bilateralStrength  = useRiggerStore((s) => s.bilateralStrength);
  const requiredBonesOnly  = useRiggerStore((s) => s.requiredBonesOnly);

  // Store actions
  const setMeshFile        = useRiggerStore((s) => s.setMeshFile);
  const clearMesh          = useRiggerStore((s) => s.clearMesh);
  const setLandmark        = useRiggerStore((s) => s.setLandmark);
  const clearLandmarks     = useRiggerStore((s) => s.clearLandmarks);
  const setActiveLandmark  = useRiggerStore((s) => s.setActiveLandmark);
  const setLandmarkMode    = useRiggerStore((s) => s.setLandmarkMode);
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

  // ── File Drop & Select ────────────────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setMeshFile(file);
      if (!characterName) {
        const base = file.name.replace(/\.[^/.]+$/, '');
        setCharacterName(base || 'Character');
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      setMeshFile(file);
      if (!characterName) {
        const base = file.name.replace(/\.[^/.]+$/, '');
        setCharacterName(base || 'Character');
      }
    }
  };

  // ── Auto Landmark Estimation ──────────────────────────────────────────────
  const handleAutoDetect = () => {
    if (!meshBbox) {
      setError('Bounding box is not available yet. Please wait for model to render.');
      return;
    }
    const estimated = estimateLandmarksFromBounds({ boundingBox: meshBbox });
    for (const [id, vec] of Object.entries(estimated)) {
      setLandmark(id as LandmarkId, vec);
    }
    confirmLandmarks();
  };

  // ── Full Pipeline Execution ───────────────────────────────────────────────
  const handleRig = async () => {
    if (!meshGeometry || !areAllLandmarksSet(landmarks)) return;

    try {
      setStage('rigging');
      setError(null);

      // 1. Fit skeleton
      setProgress({ label: 'Fitting skeleton to landmarks…', value: 0.15 });
      const fit = fitSkeletonToLandmarks(landmarks as LandmarkMap, {
        requiredOnly: requiredBonesOnly,
      });
      setFitResult(fit);

      // 2. Transfer skin weights
      setProgress({ label: 'Transferring vertex weights…', value: 0.3 });
      const raw = await transferWeightsAsync(meshGeometry, fit, new THREE.Matrix4(), {
        bilateralStrength,
        onProgress: (p) => setProgress({ label: 'Transferring vertex weights…', value: 0.3 + p * 0.3 }),
      });
      setRawWeights(raw);

      // 3. Diffuse & smooth weights
      setProgress({ label: 'Applying Laplacian diffusion smoothing…', value: 0.65 });
      const smooth = await diffuseWeightsAsync(raw, meshGeometry, {
        iterations: diffuseIterations,
        onProgress: (p) => setProgress({ label: 'Smoothing joint seams…', value: 0.65 + p * 0.2 }),
      });
      setSmoothWeights(smooth);

      // 4. Export GLB
      setProgress({ label: 'Packing & patching VRM GLB…', value: 0.9 });
      const defaultMat = new THREE.MeshStandardMaterial({
        color: 0xcccccc,
        roughness: 0.5,
        metalness: 0.0,
      });

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

  const allSet = areAllLandmarksSet(landmarks);

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-100 p-4 gap-4 text-xs select-none">
      {/* ── Title ──────────────────────────────────────────────────────────── */}
      <div className="border-b border-zinc-800 pb-3 flex items-start justify-between">
        <div>
          <h1 className="text-base font-bold text-zinc-100 flex items-center gap-2">
            <span>🦴</span> Auto-Rigger Studio
          </h1>
          <p className="text-[11px] text-zinc-400 mt-0.5">
            VRM 1.0 Humanoid · 100% Open Standards
          </p>
        </div>
        <a
          href="/"
          className="text-[10px] text-zinc-400 hover:text-zinc-200 bg-zinc-900 border border-zinc-800 px-2 py-1 rounded-md no-underline transition-colors"
        >
          ← Creator
        </a>
      </div>

      {/* ── Error Banner ───────────────────────────────────────────────────── */}
      {error && (
        <div className="bg-red-950/80 border border-red-800 text-red-200 p-3 rounded-xl flex flex-col gap-1.5">
          <div className="font-semibold text-xs flex items-center gap-1.5">
            <span>⚠️</span> Error
          </div>
          <div className="text-[11px] leading-tight">{error}</div>
          <button
            onClick={() => setError(null)}
            className="self-end text-[10px] text-red-300 underline hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── Drop Zone ──────────────────────────────────────────────────────── */}
      <div
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${
          meshFile
            ? 'border-sky-500/50 bg-sky-950/20'
            : 'border-zinc-800 hover:border-zinc-700 bg-zinc-900/50 hover:bg-zinc-900'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".glb,.gltf,.obj"
          onChange={handleFileChange}
          className="hidden"
        />
        {meshFile ? (
          <div className="flex flex-col items-center gap-1">
            <span className="text-xl">📦</span>
            <div className="font-medium text-sky-400 truncate max-w-[200px]">
              {meshFile.name}
            </div>
            <div className="text-[10px] text-zinc-500">
              {(meshFile.size / 1024 / 1024).toFixed(2)} MB · Click to change
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1">
            <span className="text-2xl text-zinc-500">📥</span>
            <div className="font-medium text-zinc-300">Drop Humanoid Model</div>
            <div className="text-[10px] text-zinc-500">GLB, GLTF or OBJ</div>
          </div>
        )}
      </div>

      {/* ── Landmarks Section ──────────────────────────────────────────────── */}
      {stage !== 'idle' && (
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-3 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-zinc-200 uppercase tracking-wider text-[10px]">
              Landmarks ({Object.keys(landmarks).length}/8)
            </span>
            <div className="flex bg-zinc-800 rounded-lg p-0.5 text-[10px]">
              <button
                onClick={() => setLandmarkMode('auto')}
                className={`px-2 py-0.5 rounded-md transition-colors ${
                  landmarkMode === 'auto' ? 'bg-sky-500 text-white font-medium' : 'text-zinc-400'
                }`}
              >
                Auto
              </button>
              <button
                onClick={() => setLandmarkMode('manual')}
                className={`px-2 py-0.5 rounded-md transition-colors ${
                  landmarkMode === 'manual' ? 'bg-sky-500 text-white font-medium' : 'text-zinc-400'
                }`}
              >
                Manual
              </button>
            </div>
          </div>

          {landmarkMode === 'auto' ? (
            <div className="flex flex-col gap-2">
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Estimates 8 key points from the mesh height and symmetry ratios.
              </p>
              <button
                onClick={handleAutoDetect}
                className="w-full py-1.5 px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-medium transition-colors flex items-center justify-center gap-1.5"
              >
                <span>⚡</span> Auto-Detect from Bounds
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-[10px] text-zinc-400">
                Select a point below, then click on the mesh surface to place it:
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {ORDERED_LANDMARKS.map((id) => {
                  const isSet = Boolean(landmarks[id]);
                  const isActive = activeLandmark === id;
                  return (
                    <button
                      key={id}
                      onClick={() => setActiveLandmark(isActive ? null : id)}
                      className={`py-1 px-2 rounded-md text-left truncate text-[10px] flex items-center justify-between border transition-all ${
                        isActive
                          ? 'border-sky-400 bg-sky-950/40 text-sky-300 font-semibold shadow-sm'
                          : isSet
                          ? 'border-zinc-700/80 bg-zinc-800/80 text-zinc-200'
                          : 'border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:border-zinc-700'
                      }`}
                    >
                      <span className="truncate">{LANDMARK_LABELS[id]}</span>
                      <span>{isSet ? '✓' : '○'}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2 mt-1">
                <button
                  onClick={clearLandmarks}
                  className="flex-1 py-1 rounded bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 text-[10px]"
                >
                  Clear All
                </button>
                <button
                  disabled={!allSet}
                  onClick={confirmLandmarks}
                  className={`flex-1 py-1 rounded text-[10px] font-medium transition-colors ${
                    allSet
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                      : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                  }`}
                >
                  Confirm (8/8)
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Rig Options ────────────────────────────────────────────────────── */}
      {stage !== 'idle' && (
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-3 flex flex-col gap-3">
          <span className="font-semibold text-zinc-200 uppercase tracking-wider text-[10px]">
            Rigging Configuration
          </span>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-zinc-400">Character Name</label>
            <input
              type="text"
              value={characterName}
              onChange={(e) => setCharacterName(e.target.value)}
              placeholder="Character"
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1 text-zinc-100 text-xs focus:outline-none focus:border-sky-500"
            />
          </div>

          <div className="flex flex-col gap-2 pt-1 border-t border-zinc-800">
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-zinc-300">VRMC_vrm 1.0 Metadata</span>
              <input
                type="checkbox"
                checked={includeVrm}
                onChange={(e) => setOption('includeVrm', e.target.checked)}
                className="accent-sky-500 h-3.5 w-3.5 rounded"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-zinc-300">Required Bones Only (22)</span>
              <input
                type="checkbox"
                checked={requiredBonesOnly}
                onChange={(e) => setOption('requiredBonesOnly', e.target.checked)}
                className="accent-sky-500 h-3.5 w-3.5 rounded"
              />
            </label>
          </div>

          <div className="flex flex-col gap-2 pt-1 border-t border-zinc-800">
            <div className="flex justify-between text-zinc-300">
              <span>Diffusion Passes</span>
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

            <div className="flex justify-between text-zinc-300 mt-1">
              <span>Bilateral Symmetry</span>
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

      {/* ── Viewport Overlays ──────────────────────────────────────────────── */}
      {stage !== 'idle' && (
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-3 flex flex-col gap-2">
          <span className="font-semibold text-zinc-200 uppercase tracking-wider text-[10px]">
            Preview Controls
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={toggleSkeleton}
              className={`py-1.5 px-2 rounded-lg border text-center transition-colors ${
                showSkeleton
                  ? 'border-sky-500/80 bg-sky-950/40 text-sky-300 font-medium'
                  : 'border-zinc-800 bg-zinc-800/40 text-zinc-400'
              }`}
            >
              Skeleton {showSkeleton ? 'ON' : 'OFF'}
            </button>
            <button
              onClick={toggleWeightMap}
              className={`py-1.5 px-2 rounded-lg border text-center transition-colors ${
                showWeightMap
                  ? 'border-sky-500/80 bg-sky-950/40 text-sky-300 font-medium'
                  : 'border-zinc-800 bg-zinc-800/40 text-zinc-400'
              }`}
            >
              Weights {showWeightMap ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>
      )}

      {/* ── Progress Bar ───────────────────────────────────────────────────── */}
      {progress && (
        <div className="bg-zinc-900 border border-sky-500/40 p-3 rounded-xl flex flex-col gap-2">
          <div className="flex justify-between text-sky-300 font-medium text-[11px]">
            <span>{progress.label}</span>
            <span>{(progress.value * 100).toFixed(0)}%</span>
          </div>
          <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
            <div
              className="bg-sky-500 h-full transition-all duration-200"
              style={{ width: `${Math.min(100, Math.max(0, progress.value * 100))}%` }}
            />
          </div>
        </div>
      )}

      {/* ── Main Action ────────────────────────────────────────────────────── */}
      <div className="mt-auto flex flex-col gap-2 pt-2">
        {stage !== 'done' ? (
          <button
            disabled={!allSet || stage === 'rigging'}
            onClick={handleRig}
            className={`w-full py-3 px-4 rounded-xl font-bold text-sm shadow-lg flex items-center justify-center gap-2 transition-all ${
              stage === 'rigging'
                ? 'bg-sky-600 text-white cursor-wait animate-pulse'
                : allSet
                ? 'bg-sky-500 hover:bg-sky-400 text-white hover:shadow-sky-500/25 cursor-pointer active:scale-[0.98]'
                : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
            }`}
          >
            <span>{stage === 'rigging' ? '⚙️' : '🚀'}</span>
            <span>{stage === 'rigging' ? 'Auto-Rigging…' : 'Rig & Export Character'}</span>
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="bg-emerald-950/60 border border-emerald-800 text-emerald-200 p-3 rounded-xl">
              <div className="font-bold flex items-center gap-1.5 text-xs text-emerald-300">
                <span>🎉</span> Rig Completed!
              </div>
              {summaryText && (
                <pre className="text-[10px] text-emerald-400/90 mt-1.5 font-mono whitespace-pre-wrap leading-tight">
                  {summaryText}
                </pre>
              )}
            </div>

            <button
              onClick={() => {
                if (lastExportBuffer) {
                  const blob = new Blob([lastExportBuffer], { type: 'model/gltf-binary' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${characterName || 'Character'}_rigged.glb`;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  setTimeout(() => URL.revokeObjectURL(url), 5000);
                }
              }}
              className="w-full py-2.5 px-4 rounded-xl font-semibold text-xs bg-emerald-600 hover:bg-emerald-500 text-white shadow-md transition-all flex items-center justify-center gap-2"
            >
              <span>⬇</span> Download Rigged GLB Again
            </button>

            <button
              onClick={reset}
              className="w-full py-1.5 px-4 rounded-xl text-xs text-zinc-400 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 transition-colors"
            >
              Start Over with New Model
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
