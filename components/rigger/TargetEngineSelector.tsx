'use client';

import { useRiggerStore } from '@/lib/rigger/store';
import {
  ENGINE_PROFILES,
  EXPORT_TARGETS,
  getEngineProfile,
  type ExportTarget,
} from '@/lib/rigger/engineProfiles';

interface TargetEngineSelectorProps {
  /** 'compact' for Phase 1 Rig Options; 'detailed' for Phase 3 Export. */
  variant?: 'compact' | 'detailed';
}

const TARGET_ACCENT: Record<ExportTarget, string> = {
  vrm: 'bg-sky-500 text-white shadow-[0_0_10px_rgba(14,165,233,0.35)]',
  unity: 'bg-emerald-600 text-white shadow-[0_0_10px_rgba(16,185,129,0.35)]',
  ue5: 'bg-indigo-500 text-white shadow-[0_0_10px_rgba(99,102,241,0.4)]',
};

/**
 * Segmented engine target selector (`VRM / Blender | Unity | UE5`).
 * Synced via `useRiggerStore.exportTarget` so Phase 1 selection presets Phase 3,
 * and switching target in Export requires zero re-rigging.
 */
export function TargetEngineSelector({ variant = 'compact' }: TargetEngineSelectorProps) {
  const exportTarget = useRiggerStore((s) => s.exportTarget);
  const setExportTarget = useRiggerStore((s) => s.setExportTarget);
  const activeProfile = getEngineProfile(exportTarget);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider whitespace-nowrap flex-shrink-0">
          Target Engine
        </span>
        <span className="text-[10px] font-mono text-zinc-300 truncate">
          {activeProfile.rootBoneLabel} · {activeProfile.unitLabel}
        </span>
      </div>

      <div
        role="radiogroup"
        aria-label="Target Game Engine"
        className="grid grid-cols-3 gap-1 bg-zinc-900 rounded-lg p-0.5 border border-zinc-800"
      >
        {EXPORT_TARGETS.map((id) => {
          const profile = ENGINE_PROFILES[id];
          const selected = exportTarget === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setExportTarget(id)}
              title={`${profile.label} (${profile.rootBoneLabel}, ${profile.unitLabel})`}
              className={`min-h-[28px] px-1.5 py-1 rounded-md text-[10px] font-semibold transition-all truncate ${
                selected
                  ? TARGET_ACCENT[id]
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/70'
              }`}
            >
              {profile.shortLabel}
            </button>
          );
        })}
      </div>

      {variant === 'detailed' && (
        <p className="text-[10px] text-zinc-400 leading-snug">
          {activeProfile.importHint}
        </p>
      )}
    </div>
  );
}
