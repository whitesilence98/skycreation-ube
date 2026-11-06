'use client';

import { useCharacter } from '@/lib/store';
import { BODY_POSES } from '@/lib/character/poses';
import { cn } from '@/lib/cn';

/**
 * The preset pose library.
 *
 * Every tile is an absolute pose over the pack's bind pose — clicking one
 * applies it whole, so the character can never end up carrying a rotation from
 * the tile before it. `REST` is the bind pose itself, which makes "undo the
 * pose" a tile rather than a second control.
 *
 * The tiles are deliberately wordless silhouettes with a label: the poses are
 * authored in `lib/character/poses.ts`, and this panel only chooses between
 * them. It carries no rig knowledge, so adding a pose is a data edit.
 */
export function PosePanel() {
  const bodyPoseId = useCharacter((s) => s.bodyPoseId);
  const setBodyPose = useCharacter((s) => s.setBodyPose);

  return (
    <div>
      <div className="mb-[7px] flex items-baseline justify-between">
        <h2 className="text-[11px] tracking-[0.02em] text-[#e2d8c6]/92">BODY POSE</h2>
        <span className="text-[7px] text-[#b6ad9c]/70">XP32 · {BODY_POSES.length}</span>
      </div>

      <div className="grid grid-cols-5 gap-[5px]">
        {BODY_POSES.map((pose) => {
          const active = pose.id === bodyPoseId;
          return (
            <button
              key={pose.id}
              type="button"
              onClick={() => setBodyPose(pose.id)}
              aria-pressed={active}
              title={`${pose.label} — ${pose.note}`}
              className="group flex flex-col items-center gap-[3px]"
            >
              <span
                className={cn(
                  'relative flex h-[46px] w-full items-center justify-center overflow-hidden border transition-all duration-200',
                  active
                    ? 'border-[#d8be8c] bg-[#d4b483]/[0.08] shadow-[0_0_12px_rgba(216,190,140,0.24),inset_0_0_10px_rgba(212,180,131,0.06)]'
                    : 'border-[#d4b483]/22 bg-black/40 group-hover:border-[#d4b483]/55',
                )}
              >
                <PoseGlyph id={pose.id} active={active} />
              </span>
              <span
                className={cn(
                  'whitespace-nowrap text-[6px] leading-[1.2] tracking-[0.1em] transition-colors',
                  active ? 'text-[#e8dcc2]' : 'text-[#a9a192]/76 group-hover:text-[#d5ccbb]',
                )}
              >
                {pose.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A tiny figure sketch, not a rendered thumbnail: the pack has no pose icons,
 * and a live render per tile would cost a second skinning pass for a control
 * that is read at a glance.
 *
 * REST is drawn as the pack's A-pose — arms angled out and down — because that
 * is what the tile actually puts on screen. A T-pose sketch would promise a
 * bind pose the pack does not ship.
 */
function PoseGlyph({ id, active }: { id: string; active: boolean }) {
  const stroke = active ? '#e8d3a6' : '#a99c85';
  const common = { stroke, strokeWidth: 1.5, strokeLinecap: 'round' as const, fill: 'none' };

  return (
    <svg viewBox="0 0 24 26" className="h-[36px] w-[22px]" aria-hidden>
      <circle cx="12" cy="4.6" r="2.1" {...common} />
      {id === 'rest' ? (
        <>
          <path d="M12 7.2v9" {...common} />
          <path d="M12 8.4 6.4 14.2M12 8.4l5.6 5.8" {...common} />
          <path d="M12 16.2 9.4 23M12 16.2l2.6 6.8" {...common} />
        </>
      ) : id === 'hands-on-hips' ? (
        <>
          <path d="M12 7.2v9" {...common} />
          <path d="M12 8.4 6.4 12.4l-1 3.4M12 8.4l5.6 4 1 3.4" {...common} />
          <path d="M12 16.2 9.6 23M12 16.2l2.4 6.8" {...common} />
        </>
      ) : id === 'contrapposto' ? (
        <>
          <path d="M12.5 7.2v9" {...common} />
          <path d="M12.5 8.4 7.4 13.8M12.5 8.4l5 5" {...common} />
          <path d="M12.5 16.2 10.2 23M12.5 16.2l3.4 6.6" {...common} />
          <path d="M7.6 17.6h9.6" {...common} opacity="0.45" />
        </>
      ) : (
        <>
          <path d="M12 7.2v9" {...common} />
          <path d="M12 8.4 7 13.8M12 8.4l5 5.4" {...common} />
          <path d="M12 16.2 9.6 23M12 16.2l2.4 6.8" {...common} />
        </>
      )}
    </svg>
  );
}
