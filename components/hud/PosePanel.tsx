'use client';

import { useState, useEffect, useMemo } from 'react';
import { useCharacter, type PoseCategory } from '@/lib/store';
import {
  BODY_POSES,
  loadPoseManifest,
  fetchPoseTrack,
  type PoseManifest,
  type PoseManifestItem,
} from '@/lib/character/poses';
import { cn } from '@/lib/cn';
import { StudioCard } from '@/components/hud/common/StudioCard';
import { IconSparkle } from '@/components/hud/Icons';
import { exportCharacterGlb } from '@/lib/exportGlb';

/**
 * Dedicated POSES Workspace Panel matching the aesthetic reference:
 * - 4-Column Card Grid with distinct white silhouette glyphs
 * - Category Tabs: [ IDLE ] [ ACTION ] [ EXPRESSIONS ] [ FAVORITES ]
 * - Realtime Pose Intensity & Animation Speed Sliders
 * - Quick REST (A-POSE) reset button
 * - External Havok Skyrim pose archive explorer
 */
export interface PosePanelProps {
  onClose?: () => void;
}

export function PosePanel({ onClose }: PosePanelProps = {}) {
  const bodyPoseId = useCharacter((s) => s.bodyPoseId);
  const setBodyPose = useCharacter((s) => s.setBodyPose);
  const poseIntensity = useCharacter((s) => s.poseIntensity);
  const setPoseIntensity = useCharacter((s) => s.setPoseIntensity);
  const animationSpeed = useCharacter((s) => s.animationSpeed);
  const setAnimationSpeed = useCharacter((s) => s.setAnimationSpeed);
  const animationId = useCharacter((s) => s.animationId);
  const setAnimationId = useCharacter((s) => s.setAnimationId);
  const animationPlaying = useCharacter((s) => s.animationPlaying);
  const setAnimationPlaying = useCharacter((s) => s.setAnimationPlaying);
  const autoBlink = useCharacter((s) => s.autoBlink);
  const setAutoBlink = useCharacter((s) => s.setAutoBlink);
  const blinkPreview = useCharacter((s) => s.blinkPreview);
  const setBlinkPreview = useCharacter((s) => s.setBlinkPreview);
  const triggerBlink = useCharacter((s) => s.triggerBlink);
  const facialExpressions = useCharacter((s) => s.facialExpressions);
  const setFacialExpression = useCharacter((s) => s.setFacialExpression);
  const setFacialExpressions = useCharacter((s) => s.setFacialExpressions);
  const resetFacialExpressions = useCharacter((s) => s.resetFacialExpressions);
  const autoRigUnskinned = useCharacter((s) => s.autoRigUnskinned);
  const setAutoRigUnskinned = useCharacter((s) => s.setAutoRigUnskinned);
  const [exportStatus, setExportStatus] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const exportGlb = async (animated: boolean) => {
    setExportBusy(true);
    setExportStatus('Exporting…');
    try {
      await exportCharacterGlb(undefined, { animated });
      setExportStatus('GLB exported');
    } catch (err) {
      setExportStatus(err instanceof Error ? err.message : 'GLB export failed');
    } finally {
      setExportBusy(false);
    }
  };
  const poseCategory = useCharacter((s) => s.poseCategory);
  const setPoseCategory = useCharacter((s) => s.setPoseCategory);
  const favoritePoses = useCharacter((s) => s.favoritePoses);
  const toggleFavoritePose = useCharacter((s) => s.toggleFavoritePose);

  const [manifest, setManifest] = useState<PoseManifest | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showExternalArchive, setShowExternalArchive] = useState(false);
  const [activeExternalPack, setActiveExternalPack] = useState<'halos' | 'gomapero'>('halos');

  useEffect(() => {
    let cancelled = false;
    void loadPoseManifest().then((m) => {
      if (!cancelled && m) {
        setManifest(m);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Filtered built-in poses by selected category
  const categorizedBuiltinPoses = useMemo(() => {
    return BODY_POSES.filter((pose) => {
      if (poseCategory === 'FAVORITES') {
        return favoritePoses.includes(pose.id);
      }
      return pose.category === poseCategory;
    });
  }, [poseCategory, favoritePoses]);

  // Counts for each category tab
  const categoryCounts = useMemo(() => {
    const idle = BODY_POSES.filter((p) => p.category === 'IDLE').length;
    const action = BODY_POSES.filter((p) => p.category === 'ACTION').length;
    const expressions = BODY_POSES.filter((p) => p.category === 'EXPRESSIONS').length;
    const favorites = favoritePoses.length;
    return { IDLE: idle, ACTION: action, EXPRESSIONS: expressions, FAVORITES: favorites };
  }, [favoritePoses]);

  // External Skyrim Havok poses
  const externalPoses = useMemo(() => {
    if (!manifest) return [];
    const allInPack = Object.values(manifest.poses).filter((p) => p.pack === activeExternalPack);
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allInPack;
    return allInPack.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        (p.category ?? '').toLowerCase().includes(q),
    );
  }, [manifest, activeExternalPack, searchQuery]);

  const handleSelectPose = (id: string, file?: string) => {
    if (file) {
      void fetchPoseTrack(id, file);
    }
    setBodyPose(id);
  };

  const isRest = bodyPoseId === 'rest';

  return (
    <StudioCard
      title="POSES & ANIMATION"
      badge="XPMSE"
      onClose={onClose}
      headerTrailing={
        <button
          type="button"
          onClick={() => setBodyPose('rest')}
          title="Reset skeleton to neutral A-pose"
          className={cn(
            'flex items-center gap-1 rounded-xs border px-1.5 py-0.5 text-[8.5px] font-mono tracking-wider transition-all duration-150',
            isRest
              ? 'border-[#d8be8c]/60 bg-[#d4b483]/20 text-[#f5ecd8]'
              : 'border-[#d4b483]/20 bg-black/40 text-[#a9a192]/80 hover:border-[#d4b483]/50 hover:text-[#e4dac5]',
          )}
        >
          REST
        </button>
      }
      footerLeading={<span>+ XPMSE 4.80</span>}
      footerTrailing={<span>{favoritePoses.length} STARRED</span>}
      showSparkle
    >
      <div className="flex flex-col gap-3">

      <div className="flex flex-col gap-2 border-b border-[#d4b483]/20 pb-3 text-[10px]">
        <label className="flex items-center justify-between gap-2">
          ANIMATION
          <select aria-label="Animation" value={animationId}
            onChange={(e) => setAnimationId(e.target.value as 'idle' | 'idle-clip' | 'selfie' | 'rest')}
            className="border border-[#d4b483]/40 bg-[#14100b] px-2 py-1 focus-visible:outline focus-visible:outline-[#eac87f]">
            <option value="idle">Breathing idle</option>
            <option value="idle-clip">Idle (XP32)</option>
            <option value="selfie">Selfie (XP32)</option>
            <option value="rest">Static pose</option>
          </select>
        </label>
        <button type="button" aria-label={animationPlaying ? 'Pause animation' : 'Play animation'}
          onClick={() => setAnimationPlaying(!animationPlaying)}
          className="border border-[#d4b483]/40 px-2 py-1 hover:bg-[#d4b483]/10 focus-visible:outline focus-visible:outline-[#eac87f]">
          {animationPlaying ? 'PAUSE' : 'PLAY'}
        </button>
        <div className="flex items-center justify-between gap-2 min-h-[24px]">
        <label className="flex items-center gap-2 min-h-[24px] cursor-pointer">
            <input type="checkbox" checked={autoBlink} onChange={(e) => setAutoBlink(e.target.checked)} />
            Auto eye blink (eyeBlinkLeft / eyeBlinkRight)
          </label>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={triggerBlink}
              title="Play one natural blink"
              className="min-h-[24px] rounded border border-[#d4b483]/35 px-2 text-[10px] tracking-wider text-[#d5ccbb] transition-colors hover:border-[#d4b483]/60 focus-visible:outline focus-visible:outline-[#eac87f]"
            >
              BLINK
            </button>
            <button
              type="button"
              onClick={() => setBlinkPreview(blinkPreview === null ? 1 : null)}
              aria-pressed={blinkPreview !== null}
              title="Freeze eyes closed to inspect eyelid closure and lashes"
              className={cn(
                'min-h-[24px] rounded border px-2 text-[10px] tracking-wider transition-colors focus-visible:outline focus-visible:outline-[#eac87f]',
                blinkPreview !== null
                  ? 'border-[#eac87f] bg-[#eac87f]/20 text-[#f5ecd8]'
                  : 'border-[#d4b483]/35 text-[#d5ccbb] hover:border-[#d4b483]/60',
              )}
            >
              {blinkPreview !== null ? 'OPEN EYES' : 'HOLD CLOSED'}
            </button>
          </div>
        </div>
        {blinkPreview !== null && (
          <label className="flex items-center justify-between gap-2 min-h-[24px] text-[10px] text-[#b6ad9c]/85">
            <span>Eye Closure</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.02"
              value={blinkPreview}
              onChange={(e) => setBlinkPreview(parseFloat(e.target.value))}
              aria-label="Eye closure preview"
              className="h-1 flex-1 cursor-pointer accent-[#d4b483] bg-black/60 rounded"
            />
            <span className="w-8 text-right font-mono text-[#eac87f]">{Math.round(blinkPreview * 100)}%</span>
          </label>
        )}
        <div className="flex flex-col gap-1.5 rounded border border-[#d4b483]/18 bg-black/35 p-2 text-[10px]">
          <div className="flex items-center justify-between gap-2">
            <span className="tracking-wider text-[#d5ccbb]">EXPRESSIONS &amp; SPEECH</span>
            <button
              type="button"
              onClick={resetFacialExpressions}
              className="min-h-[24px] rounded border border-[#d4b483]/30 px-2 text-[10px] tracking-wider text-[#d5ccbb] hover:border-[#d4b483]/60 focus-visible:outline focus-visible:outline-[#eac87f]"
            >
              RESET
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {(
              [
                ['smallSmile', 'Small Smile'],
                ['smile', 'Smile'],
                ['closedSmile', 'Closed Smile'],
                ['moodHappy', 'Happy'],
              ] as const
            ).map(([id, label]) => {
              const active = (facialExpressions[id] ?? 0) > 0;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFacialExpressions(active ? {} : { [id]: 1 })}
                  className={cn(
                    'min-h-[24px] rounded border px-2 text-[10px] tracking-wide transition-colors focus-visible:outline focus-visible:outline-[#eac87f]',
                    active
                      ? 'border-[#eac87f] bg-[#eac87f]/20 text-[#f5ecd8]'
                      : 'border-white/10 bg-black/40 text-[#b6ad9c] hover:border-[#d4b483]/50 hover:text-[#e2d8c6]',
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <label className="flex items-center justify-between gap-2 min-h-[24px] text-[10px] text-[#b6ad9c]/85">
            <span>Smile Depth</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={facialExpressions.smile ?? facialExpressions.smallSmile ?? 0}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                const key = facialExpressions.smile !== undefined ? 'smile' : 'smallSmile';
                setFacialExpression(key, v);
              }}
              aria-label="Smile intensity"
              className="h-1 flex-1 cursor-pointer accent-[#d4b483] bg-black/60 rounded"
            />
            <span className="w-8 text-right font-mono text-[#eac87f]">
              {Math.round((facialExpressions.smile ?? facialExpressions.smallSmile ?? 0) * 100)}%
            </span>
          </label>
          <div className="flex flex-wrap gap-1">
            {(
              [
                ['jawOpen', 'Jaw Open'],
                ['viseme_aa', 'Aah'],
                ['viseme_O', 'Oh'],
                ['viseme_E', 'Eh'],
                ['viseme_U', 'OohQ'],
                ['viseme_I', 'Eee'],
                ['viseme_PP', 'BMP'],
                ['viseme_FF', 'FV'],
              ] as const
            ).map(([id, label]) => {
              const active = (facialExpressions[id] ?? 0) > 0;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFacialExpressions(active ? {} : { [id]: 0.9 })}
                  className={cn(
                    'min-h-[24px] rounded border px-1.5 text-[10px] tracking-wide transition-colors focus-visible:outline focus-visible:outline-[#eac87f]',
                    active
                      ? 'border-[#eac87f] bg-[#eac87f]/20 text-[#f5ecd8]'
                      : 'border-white/10 bg-black/40 text-[#b6ad9c] hover:border-[#d4b483]/50 hover:text-[#e2d8c6]',
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <label className="flex items-center gap-2 min-h-[24px] cursor-pointer">
          <input type="checkbox" checked={autoRigUnskinned} onChange={(e) => setAutoRigUnskinned(e.target.checked)} />
          Auto-rig unweighted body / clothing
        </label>
        <div className="flex gap-2">
          <button type="button" disabled={exportBusy} onClick={() => void exportGlb(true)}
            className="border border-[#d4b483]/40 px-2 py-1 disabled:opacity-40 focus-visible:outline focus-visible:outline-[#eac87f]">EXPORT ANIMATED GLB</button>
          <button type="button" disabled={exportBusy} onClick={() => void exportGlb(false)}
            className="border border-[#d4b483]/40 px-2 py-1 disabled:opacity-40 focus-visible:outline focus-visible:outline-[#eac87f]">EXPORT STATIC GLB</button>
        </div>
        <span role="status">{exportStatus}</span>
      </div>

      {/* ── Category Navigation Tabs ─────────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5 rounded-md border border-[#d4b483]/18 bg-black/40 p-1">
        {(['IDLE', 'ACTION', 'EXPRESSIONS', 'FAVORITES'] as const).map((cat) => {
          const active = poseCategory === cat;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => {
                setPoseCategory(cat);
                setShowExternalArchive(false);
              }}
              className={cn(
                'relative flex flex-1 min-w-[110px] items-center justify-center gap-1.5 rounded px-2.5 py-1.5 text-[10px] font-medium tracking-[0.06em] transition-all duration-150',
                active
                  ? 'border border-[#d8be8c]/70 bg-[#d4b483]/20 text-[#f5ecd8] shadow-[0_0_10px_rgba(212,180,131,0.25)]'
                  : 'border border-transparent text-[#a9a192]/70 hover:bg-white/[0.04] hover:text-[#d5ccbb]',
              )}
            >
              <span>{cat}</span>
              {cat === 'FAVORITES' ? (
                <span className={cn('text-[10px]', active ? 'text-[#eac87f]' : 'text-[#a9a192]/60')}>
                  ★{categoryCounts[cat]}
                </span>
              ) : (
                <span className="text-[9.5px] opacity-60">({categoryCounts[cat]})</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── 4-Column Card Grid (Authored Poses) ───────────────────────── */}
      {!showExternalArchive && (
        <div className="min-h-[220px]">
          {categorizedBuiltinPoses.length === 0 ? (
            <div className="flex h-[200px] flex-col items-center justify-center gap-2 rounded border border-dashed border-[#d4b483]/15 text-center">
              <span className="text-[20px] text-[#d4b483]/30">★</span>
              <p className="text-[10px] tracking-wide text-[#b6ad9c]/60">
                {poseCategory === 'FAVORITES'
                  ? 'No favorite poses yet.\nClick the star (☆) on any pose card to save it here.'
                  : 'No poses in this category.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {categorizedBuiltinPoses.map((pose) => {
                const active = pose.id === bodyPoseId;
                const isFav = favoritePoses.includes(pose.id);

                return (
                  <div key={pose.id} className="relative">
                  <button
                    type="button"
                    onClick={() => handleSelectPose(pose.id)}
                    aria-pressed={active}
                    title={`${pose.label}\n${pose.note}`}
                    className={cn(
                      'group relative flex flex-col items-center justify-between rounded-md border p-2 transition-all duration-200',
                      'h-[86px] w-full',
                      active
                        ? 'border-[#f0d59e] bg-[#f0d59e]/[0.13] shadow-[0_0_12px_rgba(240,213,158,0.28)]'
                        : 'border-white/10 bg-[#12141a]/85 hover:border-[#d4b483]/45 hover:bg-[#161a22]',
                    )}
                  >
                    {/* Top Row: Favorite Star & Active Pip */}
                    <div className="flex w-full items-center justify-between">
                      {/* Active indicator dot */}
                      {active ? (
                        <span className="h-1.5 w-1.5 rounded-full bg-[#f0d59e] shadow-[0_0_5px_#f0d59e]" />
                      ) : (
                        <span className="h-1.5 w-1.5 opacity-0" />
                      )}

                      <span className="h-3 w-3" />
                    </div>

                    {/* Central Silhouette Glyph */}
                    <div className="flex h-[42px] w-full items-center justify-center">
                      <PoseSilhouette id={pose.id} active={active} />
                    </div>

                    {/* Pose Label */}
                    <span
                      className={cn(
                        'w-full truncate text-center text-[9.5px] leading-tight tracking-[0.03em] transition-colors',
                        active
                          ? 'font-medium text-[#f2e6cf]'
                          : 'text-[#a9a192]/80 group-hover:text-[#d5ccbb]',
                      )}
                    >
                      {pose.label}
                    </span>
                  </button>
                  <button type="button" onClick={() => toggleFavoritePose(pose.id)}
                    aria-label={`${isFav ? 'Remove' : 'Add'} ${pose.label} ${isFav ? 'from' : 'to'} favorites`}
                    aria-pressed={isFav}
                    className="absolute right-1 top-1 p-1 text-[11px] text-[#eac87f] focus-visible:outline focus-visible:outline-[#eac87f]">
                    {isFav ? '★' : '☆'}
                  </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── External Skyrim Havok Archive Drawer ──────────────────────── */}
      {showExternalArchive && (
        <div className="flex flex-col gap-2 rounded-md border border-[#d4b483]/15 bg-black/50 p-2.5">
          {/* Pack Selection & Search */}
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setActiveExternalPack('halos')}
                className={cn(
                  'rounded px-2 py-0.5 text-[9px] tracking-wider transition-all',
                  activeExternalPack === 'halos'
                    ? 'border border-[#d4b483]/60 bg-[#d4b483]/20 text-[#f5ecd8]'
                    : 'border border-white/10 text-[#a9a192]/70 hover:text-[#e2d8c6]',
                )}
              >
                HALO POSER ({manifest?.packs.find((p) => p.id === 'halos')?.count ?? 36})
              </button>
              <button
                type="button"
                onClick={() => setActiveExternalPack('gomapero')}
                className={cn(
                  'rounded px-2 py-0.5 text-[9px] tracking-wider transition-all',
                  activeExternalPack === 'gomapero'
                    ? 'border border-[#d4b483]/60 bg-[#d4b483]/20 text-[#f5ecd8]'
                    : 'border border-white/10 text-[#a9a192]/70 hover:text-[#e2d8c6]',
                )}
              >
                GOMAPERO ({manifest?.packs.find((p) => p.id === 'gomapero')?.count ?? 36})
              </button>
            </div>

            {/* Close Archive View */}
            <button
              type="button"
              onClick={() => setShowExternalArchive(false)}
              className="text-[9px] text-[#a9a192]/70 hover:text-[#e2d8c6]"
            >
              ← BACK
            </button>
          </div>

          {/* Search Box */}
          <div className="relative">
            <input
              type="text"
              placeholder="Search pose names..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded border border-[#d4b483]/20 bg-black/60 px-2.5 py-1 text-[10px] text-[#e2d8c6] placeholder-[#b6ad9c]/40 outline-none focus:border-[#d8be8c]/60"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[#b6ad9c]/60 hover:text-[#e2d8c6]"
              >
                ✕
              </button>
            )}
          </div>

          {/* 3-Column Havok Grid */}
          <div className="custom-scrollbar max-h-[190px] overflow-y-auto pr-0.5">
            <div className="grid grid-cols-3 gap-1.5">
              {externalPoses.map((pose) => {
                const active = pose.id === bodyPoseId;
                return (
                  <button
                    key={pose.id}
                    type="button"
                    onClick={() => handleSelectPose(pose.id, (pose as PoseManifestItem).file)}
                    className={cn(
                      'flex flex-col items-start rounded border p-1.5 text-left transition-all',
                      active
                        ? 'border-[#f0d59e] bg-[#f0d59e]/15 shadow-[0_0_8px_rgba(240,213,158,0.2)]'
                        : 'border-white/10 bg-black/40 hover:border-white/25 hover:bg-black/60',
                    )}
                  >
                    <div className="flex w-full items-center justify-between gap-1">
                      <span className="truncate text-[9.5px] font-medium text-[#e2d8c6]">
                        {pose.name}
                      </span>
                      {active && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#f0d59e]" />
                      )}
                    </div>
                    <span className="truncate text-[8.5px] text-[#a9a192]/60">
                      {(pose as PoseManifestItem).category ?? 'POSE'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Toggle for Extra Skyrim Havok Packs ─────────────────────── */}
      {!showExternalArchive && (
        <button
          type="button"
          onClick={() => setShowExternalArchive(true)}
          className="flex items-center justify-between rounded border border-[#d4b483]/15 bg-black/30 px-2.5 py-1.5 text-[9.5px] tracking-wide text-[#b6ad9c]/80 transition-colors hover:border-[#d4b483]/40 hover:text-[#e2d8c6]"
        >
          <span className="flex items-center gap-1.5">
            <span className="text-[#eac87f]">◈</span>
            BROWSE SKYRIM HAVOK ARCHIVE (72)
          </span>
          <span className="text-[8.5px] text-[#d4b483]">OPEN →</span>
        </button>
      )}

      {/* ── Bottom Sliders: Pose Intensity & Animation Speed ────────── */}
      <div className="flex flex-col gap-2.5 border-t border-[#d4b483]/15 pt-2.5">
        <div className="grid grid-cols-2 gap-3">
          {/* Pose Intensity Slider */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[9.5px] tracking-wide text-[#b6ad9c]/85">
              <span>Pose Intensity</span>
              <span className="font-mono text-[#eac87f] font-semibold">
                {Math.round(poseIntensity * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1.5"
              step="0.05"
              value={poseIntensity}
              onChange={(e) => setPoseIntensity(parseFloat(e.target.value))}
              aria-label="Pose Intensity"
              className="h-1 w-full cursor-pointer accent-[#d4b483] bg-black/60 rounded"
            />
          </div>

          {/* Animation Speed Slider */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[9.5px] tracking-wide text-[#b6ad9c]/85">
              <span>Animation Speed</span>
              <span className="font-mono text-[#eac87f] font-semibold">
                {animationSpeed.toFixed(1)}×
              </span>
            </div>
            <input
              type="range"
              min="0.2"
              max="2.0"
              step="0.1"
              value={animationSpeed}
              onChange={(e) => setAnimationSpeed(parseFloat(e.target.value))}
              aria-label="Animation Speed"
              className="h-1 w-full cursor-pointer accent-[#d4b483] bg-black/60 rounded"
            />
          </div>
        </div>
      </div>
      </div>
    </StudioCard>
  );
}

/**
 * Distinct, clean SVG stick-figure silhouettes illustrating each pose posture.
 */
function PoseSilhouette({ id, active }: { id: string; active: boolean }) {
  const stroke = active ? '#f2e4c8' : '#e0d8c7';
  const fill = active ? '#f2e4c8' : '#e0d8c7';
  const common = { stroke, strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };

  if (id === 'rest') {
    // Idle Standing (A-Pose)
    return (
      <svg viewBox="0 0 24 30" className="h-[34px] w-[22px]" aria-hidden>
        <circle cx="12" cy="4.2" r="2.2" fill={fill} />
        <path d="M12 7.2v9" {...common} />
        <path d="M12 8.6L7.2 15M12 8.6l4.8 6.4" {...common} />
        <path d="M12 16.2l-2.4 9.5M12 16.2l2.4 9.5" {...common} />
      </svg>
    );
  }

  if (id === 'fighting-stance') {
    // Fighting Stance (Fists up, crouched guard)
    return (
      <svg viewBox="0 0 24 30" className="h-[34px] w-[22px]" aria-hidden>
        <circle cx="13" cy="4.5" r="2.2" fill={fill} />
        <path d="M12.6 7.2l-1.2 8.4" {...common} />
        {/* Guarding arms with bent elbows */}
        <path d="M12 8.6l-3.4 3.2 2.2-4.2M12 8.6l3.6 2.8-1.8-3.8" {...common} />
        {/* Bent legs in martial crouch */}
        <path d="M11.4 15.6l-4.2 4.4 2.2 5.5M11.4 15.6l3.6 4.8 2.8 5.2" {...common} />
      </svg>
    );
  }

  if (id === 'greeting-wave') {
    // Greeting Wave (One arm raised high waving)
    return (
      <svg viewBox="0 0 24 30" className="h-[34px] w-[22px]" aria-hidden>
        <circle cx="11.5" cy="4.2" r="2.2" fill={fill} />
        <path d="M11.8 7.2v9" {...common} />
        {/* Left arm down, right arm waving high */}
        <path d="M11.8 8.6l-4.5 6M11.8 8.6l4.5-2.5 1.8-4" {...common} />
        <path d="M11.8 16.2l-2.4 9.5M11.8 16.2l2.4 9.5" {...common} />
      </svg>
    );
  }

  if (id === 'victory') {
    // Victory (Both arms raised high in triumphant V)
    return (
      <svg viewBox="0 0 24 30" className="h-[34px] w-[22px]" aria-hidden>
        <circle cx="12" cy="4.2" r="2.2" fill={fill} />
        <path d="M12 7.2v9" {...common} />
        {/* Raised arms */}
        <path d="M12 8.8l-5.6-4.5M12 8.8l5.6-4.5" {...common} />
        <path d="M12 16.2l-3.2 9.5M12 16.2l3.2 9.5" {...common} />
      </svg>
    );
  }

  if (id === 'defeat') {
    // Defeat (Head down, shoulders hunched, arms hanging)
    return (
      <svg viewBox="0 0 24 30" className="h-[34px] w-[22px]" aria-hidden>
        <circle cx="9.5" cy="6" r="2.2" fill={fill} />
        {/* Curved hunched spine */}
        <path d="M10.5 7.8c1.5 2 1.5 5 1 8.2" {...common} />
        {/* Limp hanging arms */}
        <path d="M11.5 9.2l-3 6.8M11.5 9.2l1.5 6.8" {...common} />
        <path d="M11.5 16l-2.2 9.5M11.5 16l2.2 9.5" {...common} />
      </svg>
    );
  }

  if (id === 'hands-on-hips') {
    // Hands on Hips (Elbows out)
    return (
      <svg viewBox="0 0 24 30" className="h-[34px] w-[22px]" aria-hidden>
        <circle cx="12" cy="4.2" r="2.2" fill={fill} />
        <path d="M12 7.2v9" {...common} />
        {/* Elbows flared out to hips */}
        <path d="M12 8.6L6.5 12.5l2.8 2.8M12 8.6l5.5 3.9-2.8 2.8" {...common} />
        <path d="M12 16.2l-2.4 9.5M12 16.2l2.4 9.5" {...common} />
      </svg>
    );
  }

  if (id === 'contrapposto') {
    // Contrapposto (Weight on one leg, tilted hips)
    return (
      <svg viewBox="0 0 24 30" className="h-[34px] w-[22px]" aria-hidden>
        <circle cx="12.6" cy="4.2" r="2.2" fill={fill} />
        <path d="M12.4 7.2c-.8 3 .8 6 0 9" {...common} />
        <path d="M12.4 8.6L7.5 14M12.4 8.6l4.6 4.8" {...common} />
        {/* Weight-bearing right leg, bent relaxed left leg */}
        <path d="M12.4 16.2l-3.2 4.5 1.5 5M12.4 16.2l2.2 9.5" {...common} />
      </svg>
    );
  }

  if (id === 'relaxed') {
    // Relaxed Stance
    return (
      <svg viewBox="0 0 24 30" className="h-[34px] w-[22px]" aria-hidden>
        <circle cx="12" cy="4.2" r="2.2" fill={fill} />
        <path d="M12 7.2v9" {...common} />
        <path d="M12 8.6l-3.6 6M12 8.6l3.6 6" {...common} />
        <path d="M12 16.2l-2.2 9.5M12 16.2l2.2 9.5" {...common} />
      </svg>
    );
  }

  if (id === 'idle-sitting') {
    // Idle Sitting (Knees bent forward)
    return (
      <svg viewBox="0 0 24 30" className="h-[34px] w-[22px]" aria-hidden>
        <circle cx="8.5" cy="5.5" r="2.2" fill={fill} />
        <path d="M8.5 8.2v9" {...common} />
        {/* Thighs horizontal, calves vertical */}
        <path d="M8.5 17.2h6.5v8.5" {...common} />
        {/* Arms resting on lap */}
        <path d="M8.5 9.8l4 4.5" {...common} />
      </svg>
    );
  }

  if (id === 'side-glance') {
    // Side Glance
    return (
      <svg viewBox="0 0 24 30" className="h-[34px] w-[22px]" aria-hidden>
        <circle cx="14" cy="4.2" r="2.2" fill={fill} />
        <path d="M12 7.2v9" {...common} />
        <path d="M12 8.6l-4.2 6M12 8.6l4.2 6" {...common} />
        <path d="M12 16.2l-2.4 9.5M12 16.2l2.4 9.5" {...common} />
      </svg>
    );
  }

  if (id === 'shy-pose') {
    // Shy (Hands together in front)
    return (
      <svg viewBox="0 0 24 30" className="h-[34px] w-[22px]" aria-hidden>
        <circle cx="12" cy="4.4" r="2.2" fill={fill} />
        <path d="M12 7.2v9" {...common} />
        {/* Arms meeting in center */}
        <path d="M12 8.6l-3.2 4.2 3.2 2.2M12 8.6l3.2 4.2-3.2 2.2" {...common} />
        <path d="M12 16.2l-1.8 9.5M12 16.2l1.8 9.5" {...common} />
      </svg>
    );
  }

  if (id === 'confident') {
    // Confident (One hand on hip, proud head)
    return (
      <svg viewBox="0 0 24 30" className="h-[34px] w-[22px]" aria-hidden>
        <circle cx="12" cy="4" r="2.2" fill={fill} />
        <path d="M12 7v9" {...common} />
        {/* Left arm relaxed, right hand on hip */}
        <path d="M12 8.4l-4.5 6M12 8.4l4.5 3-2 3" {...common} />
        <path d="M12 16l-2.4 9.5M12 16l2.4 9.5" {...common} />
      </svg>
    );
  }

  // Fallback silhouette
  return (
    <svg viewBox="0 0 24 30" className="h-[34px] w-[22px]" aria-hidden>
      <circle cx="12" cy="4.2" r="2.2" fill={fill} />
      <path d="M12 7.2v9" {...common} />
      <path d="M12 8.6l-4.2 5.5M12 8.6l4.2 5.5" {...common} />
      <path d="M12 16.2l-2.4 9.5M12 16.2l2.4 9.5" {...common} />
    </svg>
  );
}
