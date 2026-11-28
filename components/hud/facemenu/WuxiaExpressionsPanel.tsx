'use client';

import React, { useEffect, useState } from 'react';
import { useCharacter } from '@/lib/store';
import { WuxiaBreadcrumbs } from '@/components/hud/common/WuxiaBreadcrumbs';
import { WuxiaRibbonPill } from '@/components/hud/common/WuxiaRibbonPill';
import { BracketSlider } from '@/components/hud/common/BracketSlider';
import {
  EXPRESSION_CONTROLS,
  type ExpressionGroupId,
} from '@/lib/morphs/facialExpressionMorphs';
import { cn } from '@/lib/cn';

const EXPR_SECTIONS: ReadonlyArray<{ id: ExpressionGroupId; label: string; badge: string }> = [
  { id: 'mood', label: 'Mood', badge: '7 MOODS' },
  { id: 'modifier', label: 'Modifier', badge: 'EYES & BROWS' },
  { id: 'phoneme', label: 'Phoneme', badge: '16 SPEECH' },
  { id: 'extras', label: 'Smiles & Extras', badge: '16 EXPRESSIONS' },
];

export function WuxiaExpressionsPanel() {
  const [activeGroup, setActiveGroup] = useState<ExpressionGroupId | null>(null);
  const facialExpressions = useCharacter((s) => s.facialExpressions);
  const setFacialExpression = useCharacter((s) => s.setFacialExpression);
  const resetFacialExpressions = useCharacter((s) => s.resetFacialExpressions);
  const autoBlink = useCharacter((s) => s.autoBlink);
  const setAutoBlink = useCharacter((s) => s.setAutoBlink);
  const blinkPreview = useCharacter((s) => s.blinkPreview);
  const setBlinkPreview = useCharacter((s) => s.setBlinkPreview);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeGroup !== null) {
        e.preventDefault();
        setActiveGroup(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeGroup]);

  const currentMeta = activeGroup ? EXPR_SECTIONS.find((s) => s.id === activeGroup) ?? null : null;
  const items = activeGroup ? EXPRESSION_CONTROLS.filter((c) => c.group === activeGroup) : [];

  return (
    <div className="flex flex-col w-[calc(100vw-108px)] sm:w-[310px] md:w-[330px] max-w-[330px] shrink-0 select-none text-white pointer-events-auto">
      {activeGroup === null ? (
        <div className="flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-base md:text-lg font-normal tracking-wide text-white">
              Expressions
            </h1>
            <button
              type="button"
              onClick={() => {
                resetFacialExpressions();
                setBlinkPreview(null);
              }}
              className="flex min-h-[28px] items-center gap-1 rounded-sm border border-white/10 bg-[#1f2026]/80 px-2.5 text-[10px] tracking-wider uppercase text-[#c4bcae] hover:border-[#dfba73]/50 hover:text-[#eac87f] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#eac87f]"
            >
              <span aria-hidden>↺</span>
              <span>Reset All</span>
            </button>
          </div>

          <div className="mb-2.5 flex items-center justify-between gap-2 rounded-sm border border-white/8 bg-[#181920]/75 px-3 py-2 text-[11px]">
            <label className="flex items-center gap-2 cursor-pointer text-[#d4d3d9]">
              <input
                type="checkbox"
                checked={autoBlink}
                onChange={(e) => setAutoBlink(e.target.checked)}
              />
              <span>Auto Eye Blink</span>
            </label>
            <button
              type="button"
              onClick={() => setBlinkPreview(blinkPreview === null ? 1 : null)}
              aria-pressed={blinkPreview !== null}
              className={cn(
                'min-h-[24px] rounded-sm border px-2 text-[10px] font-mono uppercase tracking-wider transition-colors',
                blinkPreview !== null
                  ? 'border-[#eac87f] bg-[#dfba73]/25 text-[#f7eedc]'
                  : 'border-white/10 bg-black/30 text-[#b6ad9c] hover:border-[#dfba73]/40 hover:text-white',
              )}
            >
              {blinkPreview !== null ? 'Open Eyes' : 'Hold Closed'}
            </button>
          </div>

          <div
            className="flex flex-col gap-1.5 max-h-[calc(100vh-245px)] overflow-y-auto scrollbar-none pr-0.5"
            role="menu"
            aria-label="RaceMenu Expression Categories"
          >
            {EXPR_SECTIONS.map((sec) => {
              const secControls = EXPRESSION_CONTROLS.filter((c) => c.group === sec.id);
              const activeCount = secControls.filter((c) => (facialExpressions[c.id] ?? 0) > 0.001).length;
              return (
                <button
                  key={sec.id}
                  type="button"
                  role="menuitem"
                  onClick={() => setActiveGroup(sec.id)}
                  className="group flex h-11 min-h-[44px] shrink-0 w-full items-center justify-between rounded-sm border border-white/5 bg-[#1f2026]/75 px-3.5 text-left transition-all hover:border-[#dfba73]/40 hover:bg-[#272830] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#dfba73]"
                >
                  <span className="flex items-center gap-2 text-xs tracking-wide text-[#d4d3d9] group-hover:text-white">
                    <span>{sec.label}</span>
                    {activeCount > 0 && (
                      <span className="h-1.5 w-1.5 rounded-full bg-[#eac87f] shadow-[0_0_6px_rgba(234,200,127,0.75)]" />
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-[10px] tracking-wider text-[#8c8891] uppercase">
                      {activeCount > 0 ? `${activeCount} ACTIVE` : sec.badge}
                    </span>
                    <span className="text-sm font-light text-[#75737d] group-hover:text-white" aria-hidden>
                      ›
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex flex-col">
          <WuxiaBreadcrumbs
            category="Expressions"
            subCategory={currentMeta?.label}
            onBack={() => setActiveGroup(null)}
          />
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <WuxiaRibbonPill label={currentMeta?.label ?? ''} />
            <button
              type="button"
              onClick={() => {
                for (const item of items) setFacialExpression(item.id, 0);
              }}
              className="flex h-7 min-h-[28px] items-center gap-1 rounded-sm border border-white/10 bg-[#1f2026]/80 px-2.5 text-[10px] tracking-wider uppercase text-[#c4bcae] hover:border-[#dfba73]/50 hover:text-[#eac87f]"
            >
              <span aria-hidden>↺</span>
              <span>Reset</span>
            </button>
          </div>

          <div className="mt-3 flex flex-col gap-2.5 max-h-[calc(100vh-225px)] overflow-y-auto scrollbar-none pr-1 pb-2">
            <div className="rounded-sm border border-white/8 bg-[#181920]/70 p-3 flex flex-col gap-2.5">
              {items.map((ctrl) => {
                const val = facialExpressions[ctrl.id] ?? 0;
                return (
                  <div
                    key={ctrl.id}
                    onDoubleClick={() => setFacialExpression(ctrl.id, 0)}
                    className="cursor-pointer py-0.5"
                    title={`Double-click to reset ${ctrl.label}`}
                  >
                    <BracketSlider
                      label={ctrl.label}
                      value={val}
                      min={0}
                      max={1}
                      step={0.02}
                      display={`${Math.round(val * 100)}%`}
                      onChange={(next) => setFacialExpression(ctrl.id, next)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
