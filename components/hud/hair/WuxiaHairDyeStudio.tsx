'use client';

import React, { useState, useEffect } from 'react';
import { useCharacter } from '@/lib/store';
import { WuxiaColorPicker2D } from '@/components/hud/hair/WuxiaColorPicker2D';
import { cn } from '@/lib/cn';

export interface WuxiaHairDyeStudioProps {
  onClose?: () => void;
  className?: string;
}

type DyeMode = 'basic' | 'gradient' | 'highlights';
type SubTab = 'custom' | 'quick' | 'apply';

/** Hair strand glyph for vertical mode pills */
function IconHairStrand({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('fill-none stroke-current stroke-[1.8]', className)} aria-hidden>
      <path d="M14 3 C10 6 7 11 8 16 C8.5 18.5 10 21 11 22" strokeLinecap="round" />
      <path d="M17 5 C14 8 11.5 13 12 17 C12.5 19.5 13.5 21 14 22" strokeLinecap="round" />
    </svg>
  );
}

/**
 * WuxiaHairDyeStudio: Pixel-accurate recreation of the Wuxia Advanced Hair Dye Studio:
 * - Top Bar: [Q] Basic Hair Dye | Advanced Hair Dye [E] + Exit Chevron (<<)
 * - Left Mode Pills: Basic (Active), Gradient, Highlights
 * - Horizontal Sub-Tabs: [Z] Custom (Active), Quick, Apply [C]
 * - 2D Color Studio: Vertical Hue spectrum track + 2D Saturation/Value canvas + Recently Used + Reset
 * - Bottom Action Bar: Return, [T] Import, [R] Upload to Gallery, [F] Scene Preview, [Space] Save
 * - Keyboard listeners: Q, E, Z, C, F, Space, Escape
 */
export function WuxiaHairDyeStudio({ onClose, className }: WuxiaHairDyeStudioProps) {
  const hair = useCharacter((s) => s.hair);
  const setHair = useCharacter((s) => s.setHair);
  const previewMode = useCharacter((s) => s.previewMode);
  const setPreviewMode = useCharacter((s) => s.setPreviewMode);
  const linkBrowToHair = useCharacter((s) => s.linkBrowToHair);
  const setLinkBrowToHair = useCharacter((s) => s.setLinkBrowToHair);
  const showToast = useCharacter((s) => s.showToast);

  const [topTab, setTopTab] = useState<'basic_dye' | 'advanced_dye'>('advanced_dye');
  const [dyeMode, setDyeMode] = useState<DyeMode>('basic');
  const [subTab, setSubTab] = useState<SubTab>('custom');

  const currentColor = hair.tone || '#8C382C';

  // Keyboard shortcut routing
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      const target = e.target;
      if (target instanceof Element && target.closest('input, textarea, select')) return;

      if (e.key === 'q' || e.key === 'Q') {
        e.preventDefault();
        setTopTab('basic_dye');
        showToast('Basic Hair Dye selected');
      } else if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        setTopTab('advanced_dye');
        showToast('Advanced Hair Dye selected');
      } else if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        setSubTab('custom');
      } else if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        setSubTab((prev) => (prev === 'custom' ? 'quick' : prev === 'quick' ? 'apply' : 'custom'));
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        setPreviewMode(!previewMode);
      } else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        showToast('Hair dye saved successfully');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewMode, setPreviewMode, showToast, onClose]);

  return (
    <div className={cn('relative flex flex-col w-full min-h-[520px] select-none text-white pointer-events-auto', className)}>
      {/* ─────────────────────────────────────────────────────────────────────────────
          1. TOP BAR: [Q] Basic Hair Dye | Advanced Hair Dye [E] + Exit Chevron
          ───────────────────────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-4">
        <div className="flex items-center gap-3">
          {/* [Q] Key Badge */}
          <span className="flex h-5 w-5 items-center justify-center rounded-[2px] border border-white/30 bg-[#2b2c34] font-mono text-[10px] text-[#dfba73]">
            Q
          </span>

          {/* Basic Hair Dye Button */}
          <button
            type="button"
            onClick={() => setTopTab('basic_dye')}
            className={cn(
              'text-[13px] tracking-wide transition-colors pb-0.5',
              topTab === 'basic_dye'
                ? 'font-medium text-[#dfba73] border-b-2 border-[#dfba73]'
                : 'text-[#9f9da6] hover:text-white'
            )}
          >
            Basic Hair Dye
          </button>

          {/* Divider */}
          <span className="text-white/20">|</span>

          {/* Advanced Hair Dye Button (Active in reference) */}
          <button
            type="button"
            onClick={() => setTopTab('advanced_dye')}
            className={cn(
              'text-[13px] tracking-wide transition-colors pb-0.5',
              topTab === 'advanced_dye'
                ? 'font-semibold text-[#dfba73] border-b-2 border-[#dfba73]'
                : 'text-[#9f9da6] hover:text-white'
            )}
          >
            Advanced Hair Dye
          </button>

          {/* [E] Key Badge */}
          <span className="flex h-5 w-5 items-center justify-center rounded-[2px] border border-white/30 bg-[#2b2c34] font-mono text-[10px] text-[#dfba73]">
            E
          </span>
        </div>

        {/* Far Right: Return / Exit Chevron (<<) */}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1 text-[13px] text-[#9f9da6] hover:text-white transition-colors"
            title="Return to Hairstyle selection"
            aria-label="Return to Hairstyle selection"
          >
            <span className="font-mono text-base font-bold">«</span>
          </button>
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────────────────────────
          2. MAIN WORKSPACE: Left Vertical Pills + Middle Dye Studio
          ───────────────────────────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-5">
        {/* Left Vertical Mode Pills (Basic | Gradient | Highlights) */}
        <div className="flex flex-col gap-2 shrink-0 pt-7">
          {(
            [
              { id: 'basic', label: 'Basic' },
              { id: 'gradient', label: 'Gradient' },
              { id: 'highlights', label: 'Highlights' },
            ] as const
          ).map((item) => {
            const isActive = dyeMode === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setDyeMode(item.id)}
                className={cn(
                  'flex h-8 items-center gap-2 rounded-full px-3.5 text-xs transition-all',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#dfba73]',
                  isActive
                    ? 'bg-white text-black font-semibold shadow-md'
                    : 'bg-[#202126]/85 border border-white/10 text-[#9f9da6] hover:text-white hover:border-white/30'
                )}
                aria-current={isActive ? 'true' : undefined}
                aria-label={`Dye Mode: ${item.label}`}
              >
                <IconHairStrand className="h-3.5 w-3.5 stroke-current" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Middle Color Studio Column */}
        <div className="flex flex-col flex-1 min-w-0">
          {/* Horizontal Sub-Tabs: [Z] Custom | Quick | Apply [C] */}
          <div className="flex items-center gap-4 border-b border-white/5 pb-2 mb-3">
            {/* [Z] Key Badge */}
            <span className="flex h-4 w-4 items-center justify-center rounded-[2px] border border-white/30 bg-[#2b2c34] font-mono text-[9px] text-[#dfba73]">
              Z
            </span>

            {/* Custom Tab */}
            <button
              type="button"
              onClick={() => setSubTab('custom')}
              className={cn(
                'text-xs tracking-wider transition-colors pb-0.5',
                subTab === 'custom'
                  ? 'font-medium text-[#dfba73] border-b border-[#dfba73]'
                  : 'text-[#9f9da6] hover:text-white'
              )}
            >
              Custom
            </button>

            {/* Quick Tab */}
            <button
              type="button"
              onClick={() => setSubTab('quick')}
              className={cn(
                'text-xs tracking-wider transition-colors pb-0.5',
                subTab === 'quick'
                  ? 'font-medium text-[#dfba73] border-b border-[#dfba73]'
                  : 'text-[#9f9da6] hover:text-white'
              )}
            >
              Quick
            </button>

            {/* Apply Tab */}
            <button
              type="button"
              onClick={() => setSubTab('apply')}
              className={cn(
                'text-xs tracking-wider transition-colors pb-0.5',
                subTab === 'apply'
                  ? 'font-medium text-[#dfba73] border-b border-[#dfba73]'
                  : 'text-[#9f9da6] hover:text-white'
              )}
            >
              Apply
            </button>

            {/* [C] Key Badge */}
            <span className="flex h-4 w-4 items-center justify-center rounded-[2px] border border-white/30 bg-[#2b2c34] font-mono text-[9px] text-[#dfba73]">
              C
            </span>
          </div>

          {/* Sub-Tab Content */}
          {subTab === 'custom' && (
            <WuxiaColorPicker2D
              color={currentColor}
              onChange={(hex) => setHair({ tone: hex })}
              onReset={() => setHair({ tone: '#FFFFFF' })}
            />
          )}

          {subTab === 'quick' && (
            <div className="flex flex-col gap-3 py-2">
              <span className="text-[11px] font-mono uppercase text-[#9f9da6]">Salon Curated Swatches</span>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { name: 'Raven Black', hex: '#110E0C' },
                  { name: 'Espresso', hex: '#1C1512' },
                  { name: 'Auburn Bronze', hex: '#633722' },
                  { name: 'Deep Copper', hex: '#7B3D22' },
                  { name: 'Honey Wheat', hex: '#B5834F' },
                  { name: 'Golden Wheat', hex: '#CCA368' },
                  { name: 'Platinum Ice', hex: '#D9D0C1' },
                  { name: 'Silver Frost', hex: '#9EA2A6' },
                ].map((s) => (
                  <button
                    key={s.hex}
                    type="button"
                    onClick={() => setHair({ tone: s.hex })}
                    className={cn(
                      'flex items-center gap-2 p-1.5 rounded-[2px] border border-white/10 hover:border-white/30 transition-all text-left',
                      currentColor.toUpperCase() === s.hex.toUpperCase() ? 'border-[#dfba73] bg-white/5' : ''
                    )}
                  >
                    <span className="h-5 w-5 rounded-[2px] shrink-0 border border-black/40" style={{ backgroundColor: s.hex }} />
                    <span className="text-[10px] text-[#d4d3d9] truncate">{s.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {subTab === 'apply' && (
            <div className="flex flex-col gap-3 py-2">
              <span className="text-[11px] font-mono uppercase text-[#9f9da6]">Hair &amp; Eyebrow Color Sync</span>
              <button
                type="button"
                onClick={() => {
                  const next = !linkBrowToHair;
                  setLinkBrowToHair(next);
                  showToast(next ? 'Eyebrow color synchronized with hair' : 'Eyebrow color unlocked (custom)');
                }}
                className={cn(
                  'flex items-center justify-between p-3 rounded-[4px] border transition-all text-left',
                  linkBrowToHair ? 'border-[#dfba73] bg-[#dfba73]/10 text-white' : 'border-white/10 bg-[#1c1d22] text-[#9f9da6]'
                )}
              >
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-white">Sync Eyebrows to Hair Color</span>
                  <span className="text-[10px] text-[#9f9da6]">Automatically applies hair dye tone to eyebrow meshes</span>
                </div>
                <span className={cn('h-3.5 w-3.5 rounded-full border', linkBrowToHair ? 'bg-[#dfba73] border-[#dfba73]' : 'border-white/30')} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────────────────
          3. BOTTOM HUD ACTION BAR (Return, [T] Import, [R] Upload, [F] Preview, [Space] Save)
          ───────────────────────────────────────────────────────────────────────────── */}
      <div className="mt-8 flex items-center justify-between border-t border-white/10 pt-3">
        {/* Left: Watermark & Return */}
        <div className="flex items-center gap-4">
          <span className="font-mono text-[10px] text-[#6e6c75] tracking-widest">
            ID: 2073211823
          </span>

          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 text-xs text-[#9f9da6] hover:text-white transition-colors"
            title="Return (Escape)"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current stroke-[2]" aria-hidden>
              <polyline points="9 14 4 9 9 4" />
              <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
            </svg>
            <span>Return</span>
          </button>
        </div>

        {/* Right: Quick Action Shortcuts */}
        <div className="flex items-center gap-3">
          {/* [T] Import Dyeing */}
          <button
            type="button"
            onClick={() => showToast('Import Dyeing preset (T)')}
            className="flex items-center gap-1.5 text-xs text-[#d4d3d9] hover:text-white transition-colors"
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-[2px] border border-white/30 bg-[#2b2c34] font-mono text-[9px] text-[#dfba73]">
              T
            </span>
            <span>Import Dyeing</span>
          </button>

          {/* [R] Upload to the Gallery */}
          <button
            type="button"
            onClick={() => showToast('Hair dye preset uploaded to Gallery (R)')}
            className="flex items-center gap-1.5 text-xs text-[#d4d3d9] hover:text-white transition-colors"
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-[2px] border border-white/30 bg-[#2b2c34] font-mono text-[9px] text-[#dfba73]">
              R
            </span>
            <span>Upload to the Gallery</span>
          </button>

          {/* [F] Scene Preview */}
          <button
            type="button"
            onClick={() => setPreviewMode(!previewMode)}
            className="flex items-center gap-1.5 text-xs text-[#d4d3d9] hover:text-white transition-colors"
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-[2px] border border-white/30 bg-[#2b2c34] font-mono text-[9px] text-[#dfba73]">
              F
            </span>
            <span>Scene Preview</span>
          </button>

          {/* [Space] Save (Prominent CTA Button) */}
          <button
            type="button"
            onClick={() => showToast('Hair dye changes saved')}
            className="flex h-8 items-center gap-2 rounded-[2px] bg-white px-3.5 font-medium text-black shadow-lg transition-transform hover:scale-105 active:scale-95"
          >
            <span className="flex h-4 px-1 items-center justify-center rounded-[2px] border border-black/20 bg-black/10 font-mono text-[9px] font-bold text-black uppercase">
              Space
            </span>
            <span className="text-xs font-semibold">Save</span>
          </button>
        </div>
      </div>
    </div>
  );
}
