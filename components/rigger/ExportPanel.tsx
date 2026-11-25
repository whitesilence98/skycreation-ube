'use client';

import * as THREE from 'three';
import { useState } from 'react';
import { useRiggerStore } from '@/lib/rigger/store';
import { exportRiggedGlb, exportSummary } from '@/lib/rigger/exportRiggedGlb';
import { exportRiggedFbx, type FbxAnimationClipOption } from '@/lib/rigger/exportRiggedFbx';
import { getEngineProfile } from '@/lib/rigger/engineProfiles';
import { TargetEngineSelector } from '@/components/rigger/TargetEngineSelector';
import { isVrmBoneName } from '@/lib/rigger/vrmSkeleton';
import type { TestAnimationMode } from '@/lib/rigger/testAnimations';

function stripVertexColors(mat: THREE.Material): THREE.Material {
  const cloned = mat.clone();
  cloned.vertexColors = false;
  cloned.needsUpdate = true;
  return cloned;
}

/**
 * Prepares a texture-safe cloned geometry + material pair so active viewport
 * vertex-color heatmaps never bleed into exported GLB or FBX files.
 */
async function withCleanExportAssets<T>(
  meshGeometry: THREE.BufferGeometry,
  meshMaterial: THREE.Material | THREE.Material[] | null,
  fn: (geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[]) => Promise<T>,
): Promise<T> {
  const exportMaterial: THREE.Material | THREE.Material[] = meshMaterial
    ? Array.isArray(meshMaterial)
      ? meshMaterial.map(stripVertexColors)
      : stripVertexColors(meshMaterial)
    : new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.5, metalness: 0 });
  const geoForExport = meshGeometry.clone();
  if (geoForExport.getAttribute('color')) geoForExport.deleteAttribute('color');

  try {
    return await fn(geoForExport, exportMaterial);
  } finally {
    geoForExport.dispose();
    const mats = Array.isArray(exportMaterial) ? exportMaterial : [exportMaterial];
    mats.forEach((m) => m.dispose());
  }
}

export function ExportPanel() {
  const meshGeometry = useRiggerStore((s) => s.meshGeometry);
  const meshMaterial = useRiggerStore((s) => s.meshMaterial);
  const fitResult = useRiggerStore((s) => s.fitResult);
  const smoothWeights = useRiggerStore((s) => s.smoothWeights);
  const rawWeights = useRiggerStore((s) => s.rawWeights);
  const characterName = useRiggerStore((s) => s.characterName);
  const exportTarget = useRiggerStore((s) => s.exportTarget);
  const includeVrm = useRiggerStore((s) => s.includeVrm);
  const testAnimation = useRiggerStore((s) => s.testAnimation);
  const showSkeleton = useRiggerStore((s) => s.showSkeleton);
  const showWeightMap = useRiggerStore((s) => s.showWeightMap);
  const setCharacterName = useRiggerStore((s) => s.setCharacterName);
  const setOption = useRiggerStore((s) => s.setOption);
  const setTestAnimation = useRiggerStore((s) => s.setTestAnimation);
  const toggleSkeleton = useRiggerStore((s) => s.toggleSkeleton);
  const toggleWeightMap = useRiggerStore((s) => s.toggleWeightMap);
  const setError = useRiggerStore((s) => s.setError);

  const weights = smoothWeights || rawWeights;

  const [animClip, setAnimClip] = useState<FbxAnimationClipOption>(() =>
    testAnimation === 'tpose' ? 'walk' : testAnimation,
  );
  const [busyAction, setBusyAction] = useState<'glb' | 'fbx-skel' | 'fbx-anim' | null>(null);
  const [lastGlbSummary, setLastGlbSummary] = useState<string | null>(null);
  const [lastFbxSkelInfo, setLastFbxSkelInfo] = useState<string | null>(null);
  const [lastFbxAnimInfo, setLastFbxAnimInfo] = useState<string | null>(null);

  if (!fitResult || !weights || !meshGeometry) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 text-[11px] text-zinc-400">
        No rigged skeleton available yet. Return to markers and run Auto-Rig first.
      </div>
    );
  }

  const safeName = characterName.trim() || 'Character';
  const activeProfile = getEngineProfile(exportTarget);
  const preferFbx = exportTarget === 'unity' || exportTarget === 'ue5';
  const vrmCount = fitResult.built.bones.filter((b) => isVrmBoneName(b.name)).length;
  const secCount = fitResult.built.bones.length - vrmCount;

  const handleSelectAnimClip = (choice: FbxAnimationClipOption) => {
    setAnimClip(choice);
    if (choice !== 'all') {
      setTestAnimation(choice);
    } else if (testAnimation === 'tpose') {
      setTestAnimation('walk');
    }
  };

  const handleDownloadGlb = async () => {
    setBusyAction('glb');
    setError(null);
    try {
      await withCleanExportAssets(meshGeometry, meshMaterial, async (geo, mat) => {
        const buffer = await exportRiggedGlb(geo, mat, fitResult, weights, {
          name: safeName,
          includeVrmExtension: includeVrm,
          download: true,
        });
        setLastGlbSummary(exportSummary(fitResult, weights, buffer.byteLength, safeName));
      });
    } catch (err) {
      setError(`GLB export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyAction(null);
    }
  };

  const handleDownloadFbxSkeleton = async () => {
    setBusyAction('fbx-skel');
    setError(null);
    try {
      await withCleanExportAssets(meshGeometry, meshMaterial, async (geo, mat) => {
        const res = await exportRiggedFbx(geo, mat, fitResult, weights, {
          name: safeName,
          target: exportTarget,
          includeAnimation: false,
          download: true,
        });
        const mb = (res.byteLength / 1_048_576).toFixed(2);
        setLastFbxSkelInfo(`${res.filename} · ${mb} MB`);
      });
    } catch (err) {
      setError(`FBX export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyAction(null);
    }
  };

  const handleDownloadFbxAnim = async () => {
    setBusyAction('fbx-anim');
    setError(null);
    try {
      await withCleanExportAssets(meshGeometry, meshMaterial, async (geo, mat) => {
        const res = await exportRiggedFbx(geo, mat, fitResult, weights, {
          name: safeName,
          target: exportTarget,
          includeAnimation: true,
          animationClip: animClip,
          download: true,
        });
        const mb = (res.byteLength / 1_048_576).toFixed(2);
        setLastFbxAnimInfo(`${res.filename} · ${res.clipNames.join(', ')} · ${mb} MB`);
      });
    } catch (err) {
      setError(`FBX animated export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyAction(null);
    }
  };

  const glbCard = (
    <div
      key="glb"
      className={`rounded-xl border p-3 flex flex-col gap-2 ${
        !preferFbx ? 'border-emerald-500/40 bg-emerald-950/15' : 'border-zinc-800 bg-zinc-900/50'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-100">GLB · Binary glTF</span>
        <span className="text-[10px] text-sky-400 bg-sky-950/60 border border-sky-800/60 px-1.5 py-0.5 rounded">
          {!preferFbx ? 'Recommended · VRM' : 'VRM / Blender'}
        </span>
      </div>
      <label className="min-h-[24px] flex items-center justify-between cursor-pointer">
        <span className="text-[10px] text-zinc-300">Include VRM 1.0 Metadata</span>
        <input
          type="checkbox"
          checked={includeVrm}
          onChange={(e) => setOption('includeVrm', e.target.checked)}
          className="accent-sky-500 h-3.5 w-3.5"
        />
      </label>
      <button
        type="button"
        disabled={busyAction !== null}
        onClick={handleDownloadGlb}
        className="w-full min-h-[34px] py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
      >
        <span>{busyAction === 'glb' ? '⏳ Packing GLB…' : '⬇ Download GLB (VRM 1.0)'}</span>
      </button>
      {lastGlbSummary && (
        <pre className="text-[10px] text-emerald-400/90 font-mono whitespace-pre-wrap leading-tight border-t border-zinc-800 pt-1.5">
          {lastGlbSummary}
        </pre>
      )}
    </div>
  );

  const fbxSkeletonCard = (
    <div
      key="fbx-skel"
      className={`rounded-xl border p-3 flex flex-col gap-2 ${
        preferFbx ? 'border-sky-500/40 bg-sky-950/15' : 'border-zinc-800 bg-zinc-900/50'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-100">FBX · Skeleton Only</span>
        <span className="text-[10px] text-amber-300 bg-amber-950/50 border border-amber-800/50 px-1.5 py-0.5 rounded">
          {activeProfile.label}
        </span>
      </div>
      <p className="text-[10px] text-zinc-400 leading-snug">
        Bind-pose {activeProfile.rootBoneLabel} hierarchy in {activeProfile.unitLabel} for{' '}
        <span className="font-mono text-zinc-300">{safeName}_{activeProfile.fbxSuffixTag}_skeleton.fbx</span>.
      </p>
      <button
        type="button"
        disabled={busyAction !== null}
        onClick={handleDownloadFbxSkeleton}
        className="w-full min-h-[34px] py-2 px-3 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
      >
        <span>
          {busyAction === 'fbx-skel'
            ? '⏳ Writing FBX…'
            : `⬇ Download FBX (${activeProfile.shortLabel})`}
        </span>
      </button>
      {lastFbxSkelInfo && (
        <div className="text-[10px] font-mono text-sky-300 truncate">{lastFbxSkelInfo}</div>
      )}
    </div>
  );

  const fbxAnimCard = (
    <div
      key="fbx-anim"
      className={`rounded-xl border p-3 flex flex-col gap-2 ${
        preferFbx ? 'border-purple-500/40 bg-purple-950/15' : 'border-zinc-800 bg-zinc-900/50'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-100">FBX · With Animation</span>
        <span className="text-[10px] text-purple-300 bg-purple-950/50 border border-purple-800/50 px-1.5 py-0.5 rounded">
          {activeProfile.badgeText} · 30 FPS
        </span>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {([
          ['idle', 'Idle'],
          ['walk', 'Walk'],
          ['run',  'Run'],
          ['all',  'All 3'],
        ] as [FbxAnimationClipOption, string][]).map(([val, label]) => (
          <button
            key={val}
            type="button"
            onClick={() => handleSelectAnimClip(val)}
            className={`min-h-[26px] py-1 text-[10px] font-semibold rounded-lg border transition-all ${
              animClip === val
                ? 'border-purple-400 bg-purple-950/60 text-purple-200'
                : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={busyAction !== null}
        onClick={handleDownloadFbxAnim}
        className="w-full min-h-[34px] py-2 px-3 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
      >
        <span>
          {busyAction === 'fbx-anim'
            ? '⏳ Baking Animation FBX…'
            : `⬇ Download ${activeProfile.shortLabel} FBX + ${animClip === 'all' ? 'All Clips' : animClip.charAt(0).toUpperCase() + animClip.slice(1)}`}
        </span>
      </button>
      {lastFbxAnimInfo && (
        <div className="text-[10px] font-mono text-purple-300 break-all">{lastFbxAnimInfo}</div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      {/* ── Rig stats summary ────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
            Ready to Export
          </span>
          <span className="text-[10px] font-mono text-emerald-400">
            {fitResult.built.bones.length} bones
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-zinc-300 border-t border-emerald-900/50 pt-2">
          <div className="flex justify-between">
            <span className="text-zinc-500">Height</span>
            <span className="font-mono">{fitResult.characterHeight.toFixed(2)} m</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Vertices</span>
            <span className="font-mono">{weights.vertexCount.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">VRM Bones</span>
            <span className="font-mono">{vrmCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Custom</span>
            <span className="font-mono">{secCount}</span>
          </div>
        </div>
      </div>

      {/* ── Engine target selector (switchable without re-rigging) ──────────── */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 flex flex-col gap-2">
        <TargetEngineSelector variant="detailed" />
      </div>

      {/* ── Primary engine export cards first, GLB fallback when FBX preferred ── */}
      {preferFbx ? [fbxSkeletonCard, fbxAnimCard, glbCard] : [glbCard, fbxSkeletonCard, fbxAnimCard]}

      {/* ── Export name + quick preview sync ────────────────────────────────── */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 flex flex-col gap-2.5">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-zinc-400">Character Name</label>
          <input
            type="text"
            value={characterName}
            onChange={(e) => setCharacterName(e.target.value)}
            placeholder="Character"
            className="min-h-[30px] bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-zinc-100 text-xs focus:outline-none focus:border-sky-500"
          />
        </div>

        <div className="flex flex-col gap-1.5 border-t border-zinc-800 pt-2">
          <span className="text-[10px] text-zinc-400 uppercase tracking-wider">Viewport Preview</span>
          <div className="grid grid-cols-4 gap-1">
            {(['tpose', 'idle', 'walk', 'run'] as TestAnimationMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setTestAnimation(mode)}
                className={`min-h-[26px] py-1 text-[10px] font-semibold rounded-lg border transition-all ${
                  testAnimation === mode
                    ? 'border-sky-400 bg-sky-950/50 text-sky-200'
                    : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {mode === 'tpose' ? 'T-Pose' : mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1.5 mt-0.5">
            <button
              type="button"
              onClick={toggleSkeleton}
              className={`min-h-[26px] py-1 px-2 rounded-lg border text-[10px] transition-colors ${
                showSkeleton ? 'border-sky-500/60 bg-sky-950/40 text-sky-300 font-medium' : 'border-zinc-800 bg-zinc-900/50 text-zinc-400'
              }`}
            >
              🦴 Skeleton {showSkeleton ? 'ON' : 'OFF'}
            </button>
            <button
              type="button"
              onClick={toggleWeightMap}
              className={`min-h-[26px] py-1 px-2 rounded-lg border text-[10px] transition-colors ${
                showWeightMap ? 'border-sky-500/60 bg-sky-950/40 text-sky-300 font-medium' : 'border-zinc-800 bg-zinc-900/50 text-zinc-400'
              }`}
            >
              🎨 Weights {showWeightMap ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
