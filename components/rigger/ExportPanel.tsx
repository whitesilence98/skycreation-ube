'use client';

import * as THREE from 'three';
import { useState } from 'react';
import { useRiggerStore } from '@/lib/rigger/store';
import { exportRiggedGlb, exportSummary, type WeightSource } from '@/lib/rigger/exportRiggedGlb';
import { exportRiggedFbx, type FbxAnimationClipOption } from '@/lib/rigger/exportRiggedFbx';
import { getEngineProfile } from '@/lib/rigger/engineProfiles';
import { TargetEngineSelector } from '@/components/rigger/TargetEngineSelector';
import { packGeometryAndMaterialsIntoAtlas, isDefaultPackableMaterial } from '@/lib/export/skinAtlasPacker';
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
  weights: WeightSource,
  packTextureAtlas: boolean,
  fn: (geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], exportWeights: WeightSource) => Promise<T>,
): Promise<T> {
  const exportMaterial: THREE.Material | THREE.Material[] = meshMaterial
    ? Array.isArray(meshMaterial)
      ? meshMaterial.map(stripVertexColors)
      : stripVertexColors(meshMaterial)
    : new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.5, metalness: 0 });
  const geoForExport = meshGeometry.clone();
  if (geoForExport.getAttribute('color')) geoForExport.deleteAttribute('color');

  const extraTextures: THREE.Texture[] = [];
  let activeGeo = geoForExport;
  let activeMat: THREE.Material | THREE.Material[] = exportMaterial;
  let activeWeights: WeightSource = weights;

  if (packTextureAtlas && Array.isArray(exportMaterial) && exportMaterial.length >= 2) {
    geoForExport.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(weights.skinIndex), 4));
    geoForExport.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(weights.skinWeight), 4));

    const packed = packGeometryAndMaterialsIntoAtlas(geoForExport, exportMaterial, {
      atlasSize: 2048,
      paddingPx: 8,
      materialName: 'Skin_Atlas',
      smoothBoundaryNormals: true,
    });
    if (packed.packedSlotCount >= 2) {
      geoForExport.dispose();
      activeGeo = packed.geometry;
      activeMat = packed.materials.length === 1 ? packed.materials[0]! : packed.materials;
      extraTextures.push(...packed.packedTextures);

      const sIdx = packed.geometry.getAttribute('skinIndex');
      const sWt = packed.geometry.getAttribute('skinWeight');
      if (sIdx && sWt) {
        activeWeights = {
          ...weights,
          vertexCount: packed.geometry.getAttribute('position').count,
          skinIndex: Uint16Array.from(sIdx.array as ArrayLike<number>),
          skinWeight: Float32Array.from(sWt.array as ArrayLike<number>),
        };
      }
    }
  }

  try {
    return await fn(activeGeo, activeMat, activeWeights);
  } finally {
    activeGeo.dispose();
    const origMats = Array.isArray(exportMaterial) ? exportMaterial : [exportMaterial];
    origMats.forEach((m) => m.dispose());
    const finalMats = Array.isArray(activeMat) ? activeMat : [activeMat];
    finalMats.forEach((m) => m.dispose());
    extraTextures.forEach((t) => t.dispose());
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
  const [busyAction, setBusyAction] = useState<'glb' | 'fbx-skel' | 'fbx-anim' | 'atlas-glb' | 'atlas-fbx' | null>(null);
  const [lastGlbSummary, setLastGlbSummary] = useState<string | null>(null);
  const [lastFbxSkelInfo, setLastFbxSkelInfo] = useState<string | null>(null);
  const [lastFbxAnimInfo, setLastFbxAnimInfo] = useState<string | null>(null);
  const [lastAtlasInfo, setLastAtlasInfo] = useState<string | null>(null);

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
  const packableMaterialCount = Array.isArray(meshMaterial)
    ? meshMaterial.filter((m) => isDefaultPackableMaterial(m)).length
    : 0;
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
      await withCleanExportAssets(meshGeometry, meshMaterial, weights, false, async (geo, mat, exportWts) => {
        const buffer = await exportRiggedGlb(geo, mat, fitResult, exportWts, {
          name: safeName,
          includeVrmExtension: includeVrm,
          download: true,
        });
        setLastGlbSummary(exportSummary(fitResult, exportWts, buffer.byteLength, safeName));
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
      await withCleanExportAssets(meshGeometry, meshMaterial, weights, false, async (geo, mat, exportWts) => {
        const res = await exportRiggedFbx(geo, mat, fitResult, exportWts, {
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
      await withCleanExportAssets(meshGeometry, meshMaterial, weights, false, async (geo, mat, exportWts) => {
        const res = await exportRiggedFbx(geo, mat, fitResult, exportWts, {
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

  const handleDownloadAtlasGlb = async () => {
    setBusyAction('atlas-glb');
    setError(null);
    try {
      await withCleanExportAssets(meshGeometry, meshMaterial, weights, true, async (geo, mat, exportWts) => {
        const atlasName = `${safeName}_atlas`;
        const buffer = await exportRiggedGlb(geo, mat, fitResult, exportWts, {
          name: atlasName,
          includeVrmExtension: includeVrm,
          download: true,
        });
        const mb = (buffer.byteLength / 1_048_576).toFixed(2);
        setLastAtlasInfo(`${atlasName}_rigged.glb · 1 Skin Material · ${mb} MB`);
      });
    } catch (err) {
      setError(`Atlas GLB export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyAction(null);
    }
  };

  const handleDownloadAtlasFbx = async () => {
    setBusyAction('atlas-fbx');
    setError(null);
    try {
      await withCleanExportAssets(meshGeometry, meshMaterial, weights, true, async (geo, mat, exportWts) => {
        const res = await exportRiggedFbx(geo, mat, fitResult, exportWts, {
          name: `${safeName}_atlas`,
          target: exportTarget,
          includeAnimation: false,
          download: true,
        });
        const mb = (res.byteLength / 1_048_576).toFixed(2);
        setLastAtlasInfo(`${res.filename} · 1 Skin Material · ${mb} MB`);
      });
    } catch (err) {
      setError(`Atlas FBX export failed: ${err instanceof Error ? err.message : String(err)}`);
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

      {/* ── Primary engine export cards first (existing separate-material paths) ── */}
      {preferFbx ? [fbxSkeletonCard, fbxAnimCard, glbCard] : [glbCard, fbxSkeletonCard, fbxAnimCard]}

      {/* ── Option 4: Separate Skin UV Atlas Export (1 Material) ────────────── */}
      <div className="rounded-xl border border-amber-500/35 bg-amber-950/15 p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-zinc-100">Skin UV Atlas · 1 Material</span>
          <span className="text-[10px] text-amber-300 bg-amber-950/60 border border-amber-800/60 px-1.5 py-0.5 rounded">
            {packableMaterialCount >= 2 ? `${packableMaterialCount} Parts → 1` : '1 Material'}
          </span>
        </div>
        <p className="text-[10px] text-zinc-400 leading-snug">
          {packableMaterialCount >= 2
            ? `Separate packed export combining ${packableMaterialCount} body/skin UVs & maps into one unified PBR sheet.`
            : 'Model already has 1 skin material; upload a multi-part mesh (Head + Body + Hands + Feet) to pack UVs.'}
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            disabled={busyAction !== null || packableMaterialCount < 2}
            onClick={handleDownloadAtlasGlb}
            className="min-h-[32px] py-1.5 px-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white text-[11px] font-semibold flex items-center justify-center transition-colors"
          >
            {busyAction === 'atlas-glb' ? '⏳ Packing…' : '⬇ Atlas GLB'}
          </button>
          <button
            type="button"
            disabled={busyAction !== null || packableMaterialCount < 2}
            onClick={handleDownloadAtlasFbx}
            className="min-h-[32px] py-1.5 px-2.5 rounded-lg bg-amber-700 hover:bg-amber-600 disabled:bg-zinc-800 disabled:text-zinc-500 text-white text-[11px] font-semibold flex items-center justify-center transition-colors"
          >
            {busyAction === 'atlas-fbx' ? '⏳ Packing…' : `⬇ Atlas FBX (${activeProfile.shortLabel})`}
          </button>
        </div>
        {lastAtlasInfo && (
          <div className="text-[10px] font-mono text-amber-300 break-all">{lastAtlasInfo}</div>
        )}
      </div>

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
