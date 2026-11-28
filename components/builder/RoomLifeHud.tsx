'use client';

import { useState } from 'react';
import { useBuilderStore } from '@/lib/builderStore';
import {
  formatSimClock,
  useRoomLifeStore,
  type TimeScale,
} from '@/lib/builder/lifeStore';
import type { ActionTag, NeedKey } from '@/lib/builder/smartObjects';
import { useGraphicsSettings } from '@/lib/graphicsSettings';
import { cn } from '@/lib/cn';

const SPEED_OPTIONS: ReadonlyArray<{ value: TimeScale; label: string }> = [
  { value: 0, label: '⏸' },
  { value: 1, label: '1×' },
  { value: 3, label: '3×' },
  { value: 10, label: '10×' },
];

const ACTION_ICONS: Record<ActionTag, string> = {
  idle: '✦',
  sleep: '💤',
  sit: '🛋️',
  groom: '🪞',
  read: '📖',
  laptop: '💻',
  tv: '📺',
  admire: '🌿',
};

const NEED_META: ReadonlyArray<{ key: NeedKey; label: string }> = [
  { key: 'energy', label: 'Energy' },
  { key: 'comfort', label: 'Comfort' },
  { key: 'fun', label: 'Fun' },
  { key: 'grooming', label: 'Groom' },
];

/**
 * Compact clock & time-speed pill mounted inside `BuilderHud`'s top navigation bar.
 */
export function ClockControlsPill() {
  const mode = useBuilderStore((s) => s.mode);
  const simTimeMinutes = useRoomLifeStore((s) => s.simTimeMinutes);
  const timeScale = useRoomLifeStore((s) => s.timeScale);
  const aiEnabled = useRoomLifeStore((s) => s.aiEnabled);
  const setTimeScale = useRoomLifeStore((s) => s.setTimeScale);
  const toggleAi = useRoomLifeStore((s) => s.toggleAi);

  const clock = formatSimClock(simTimeMinutes);
  const isTour = mode === 'tour';

  return (
    <div
      aria-label="In-Game Clock and AI Speed"
      className="flex items-center gap-1 rounded-[2px] border border-white/15 bg-[#1b1c23]/85 p-0.5 font-mono text-[10px] text-[#dcd6cb]"
    >
      <span
        className="flex items-center gap-1 px-1.5 text-[#f2dfbe]"
        title={`Day ${clock.day} · ${clock.formatted}`}
      >
        <span aria-hidden>{clock.isNight ? '🌙' : '☀'}</span>
        <span>D{clock.day}</span>
        <span className="tabular-nums font-semibold">{clock.formatted}</span>
      </span>

      <span className="h-3.5 w-px bg-white/15" aria-hidden />

      {isTour ? (
        <span
          className="px-1.5 text-[10px] tracking-wider text-[#8c8891] uppercase"
          title="Daytime clock and Room Life AI are auto-paused in Tour mode"
        >
          Paused
        </span>
      ) : (
        <>
          <div className="flex items-center gap-0.5" role="group" aria-label="Time Speed">
            {SPEED_OPTIONS.map((opt) => {
              const active = timeScale === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTimeScale(opt.value)}
                  aria-pressed={active}
                  title={opt.value === 0 ? 'Pause simulation clock' : `Set simulation speed to ${opt.label}`}
                  className={cn(
                    'min-h-[24px] min-w-[24px] rounded-[2px] px-1.5 text-[10px] transition-colors focus-visible:outline focus-visible:outline-[#eac87f]',
                    active
                      ? 'bg-[#dfba73]/25 text-[#f7eedc] border border-[#dfba73]/70'
                      : 'text-[#a8a39b] hover:bg-white/10 hover:text-white border border-transparent',
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <span className="h-3.5 w-px bg-white/15" aria-hidden />

          <button
            type="button"
            onClick={toggleAi}
            aria-pressed={aiEnabled}
            title="Toggle autonomous Room Life AI when building/decorating"
            className={cn(
              'min-h-[24px] rounded-[2px] px-1.5 text-[10px] uppercase tracking-wider transition-colors focus-visible:outline focus-visible:outline-[#eac87f]',
              aiEnabled
                ? 'bg-[#dfba73]/20 text-[#eac87f] border border-[#dfba73]/60'
                : 'text-[#8c8891] hover:text-white border border-transparent',
            )}
          >
            AI {aiEnabled ? 'ON' : 'OFF'}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Compact bottom-right Needs & Live Activity telemetry card for Room Life AI.
 */
export function RoomLifeNeedsCard() {
  const [expanded, setExpanded] = useState(false);
  const mode = useBuilderStore((s) => s.mode);
  const aiEnabled = useRoomLifeStore((s) => s.aiEnabled);
  const activity = useRoomLifeStore((s) => s.activity);
  const needs = useRoomLifeStore((s) => s.needs);
  const thoughtLog = useRoomLifeStore((s) => s.thoughtLog);
  const glassBlur = useGraphicsSettings((s) => s.glassBlur);

  if (mode === 'tour' || !aiEnabled) return null;

  const icon = ACTION_ICONS[activity.actionTag] ?? '✦';

  return (
    <aside
      aria-label="Character Room Life Status"
      className={cn(
        'pointer-events-auto absolute right-3 bottom-12 z-20 hidden sm:flex w-[228px] flex-col rounded-[4px] border border-[#d4b483]/35 bg-[#15161c]/94 p-2.5 text-[#f2efe8] shadow-[0_10px_30px_rgba(0,0,0,0.55)] select-none',
        glassBlur && 'backdrop-blur-md',
      )}
    >
      {/* Header / Activity Row */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex min-h-[28px] w-full items-center justify-between gap-2 text-left focus-visible:outline focus-visible:outline-[#eac87f]"
        title="Toggle Room Life Needs & Thought Log"
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="text-[12px]" aria-hidden>
            {icon}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[11px] font-medium text-[#f5ecd8]">
              {activity.label}
            </div>
            <div className="truncate font-mono text-[10px] text-[#9b968e]">
              {activity.reason}
              {activity.state === 'acting' ? ` · ${Math.round(activity.progress * 100)}%` : ''}
            </div>
          </div>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-[#dfba73]">
          {expanded ? '▾' : '▸'}
        </span>
      </button>

      {/* Progress Bar when performing a Smart Object action */}
      {activity.state === 'acting' && (
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full bg-gradient-to-r from-[#caa058] to-[#f1d59b] transition-all duration-200"
            style={{ width: `${Math.round(activity.progress * 100)}%` }}
          />
        </div>
      )}

      {/* Compact 4-Need Bars */}
      <div className="mt-2 grid grid-cols-2 gap-x-2.5 gap-y-1.5">
        {NEED_META.map((m) => {
          const val = Math.round(needs[m.key]);
          const low = val < 30;
          return (
            <div key={m.key} className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between font-mono text-[10px]">
                <span className="text-[#aba69d]">{m.label}</span>
                <span className={low ? 'text-[#e5937a]' : 'text-[#e4cca8]'}>{val}%</span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className={cn(
                    'h-full transition-all duration-300',
                    low ? 'bg-[#d97757]' : 'bg-[#dfba73]',
                  )}
                  style={{ width: `${val}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Expandable Thought Log */}
      {expanded && (
        <div className="mt-2 border-t border-white/10 pt-1.5">
          <div className="mb-1 font-mono text-[10px] tracking-wider text-[#9b968e] uppercase">
            Decision Log
          </div>
          <ul className="max-h-[96px] space-y-1 overflow-y-auto scrollbar-none font-mono text-[10px] leading-snug text-[#cbc5ba]">
            {thoughtLog.map((entry, idx) => (
              <li key={`${idx}-${entry}`} className="truncate" title={entry}>
                {entry}
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
