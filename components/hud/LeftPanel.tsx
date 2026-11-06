'use client';

import type { Mo2Manifest } from '@/lib/head/faceTexture';
import { useCharacter, type UtilityToggles } from '@/lib/store';
import { PRESETS, REGIONS } from '@/lib/regions';
import { FaceDiagram } from '@/components/hud/FaceDiagram';
import { HairStyles } from '@/components/hud/HairStyles';
import { PosePanel } from '@/components/hud/PosePanel';
import {
  IconAlbum,
  IconCamera,
  IconCheck,
  IconFocus,
  IconHanger,
  IconPose,
  IconRevert,
  IconSparkle,
} from '@/components/hud/Icons';
import { cn } from '@/lib/cn';

const UTILITIES: Array<{
  key: keyof UtilityToggles;
  label: string;
  sub?: string;
  Icon: (p: { className?: string }) => React.JSX.Element;
}> = [
  { key: 'camPreset', label: 'CAM PRESET', Icon: IconCamera },
  { key: 'beautyAlbum', label: 'BEAUTY', sub: 'ALBUM', Icon: IconAlbum },
  { key: 'poseEdit', label: 'POSE', sub: 'EDIT', Icon: IconPose },
  { key: 'viewOutfit', label: 'VIEW', sub: 'OUTFIT', Icon: IconHanger },
  { key: 'cameraFocus', label: 'CAMERA', sub: 'FOCUS (ON)', Icon: IconFocus },
  { key: 'historyRevert', label: 'HISTORY', sub: 'REVERT', Icon: IconRevert },
];

/**
 * The mesh net is not a MO2 utility — it is the BDO readout over the face —
 * so it gets its own control rather than sharing the utility grid.
 */

function Toggle({ on, className }: { on: boolean; className?: string }) {
  return (
    <span
      className={cn(
        'mt-[2px] flex h-[21px] w-[30px] shrink-0 items-center rounded-full border px-[2px] transition-all duration-200',
        on ? 'border-[#d4b483]/45 bg-[#d4b483]/16' : 'border-[#8c8477]/28 bg-black/40',
        className,
      )}
    >
      <span
        className={cn(
          'block h-[13px] w-[13px] rounded-full transition-transform duration-200',
          on ? 'translate-x-[9px] bg-[#dcc79d] shadow-[0_0_7px_rgba(234,200,127,0.55)]' : 'translate-x-0 bg-[#6b6459]',
        )}
      />
    </span>
  );
}

function SectionTitle({ children, trailing }: { children: React.ReactNode; trailing?: React.ReactNode }) {
  return (
    <div className="mb-[7px] flex items-baseline justify-between">
      <h2 className="text-[11px] font-normal tracking-[0.02em] text-[#e2d8c6]/92">{children}</h2>
      {trailing}
    </div>
  );
}

export function LeftPanel({ manifest }: { manifest: Mo2Manifest | null }) {
  const utils = useCharacter((s) => s.utils);
  const toggleUtil = useCharacter((s) => s.toggleUtil);
  const bisymmetry = useCharacter((s) => s.bisymmetry);
  const asymmetry = useCharacter((s) => s.asymmetry);
  const setBisymmetry = useCharacter((s) => s.setBisymmetry);
  const setAsymmetry = useCharacter((s) => s.setAsymmetry);
  const showMesh = useCharacter((s) => s.showMesh);
  const setShowMesh = useCharacter((s) => s.setShowMesh);
  const primaryTab = useCharacter((s) => s.primaryTab);
  const activeRegion = useCharacter((s) => s.activeRegion);
  const setActiveRegion = useCharacter((s) => s.setActiveRegion);
  const preset = useCharacter((s) => s.preset);
  const applyPreset = useCharacter((s) => s.applyPreset);

  return (
    /* Reference metric (1024 × 572): the rail is 222 px of content starting
       at x = 71 — the cards run 71→293 on a 114 px pitch. The utilities sit
       above at y = 61 on a 26 px pitch, and the header block is inset 45 px
       from them, which is why this panel is not flush to the viewport edge. */
    <aside className="pointer-events-auto absolute left-[71px] top-[61px] z-20 w-[222px] select-none hud-fade">
      {/* ── utility grid ───────────────────────────────────────────
          HAIR is a styling section, not a face-sculpt or export one: the
          MO2 utilities and METRIC MESH would compete with the style grid and
          have nothing to act on, so they collapse there. FACE keeps them. */}
      {primaryTab !== 'HAIR' && (
      <div className="grid grid-cols-2 gap-x-[8px] gap-y-[2px]">
        {UTILITIES.map(({ key, label, sub, Icon }) => {
          const on = utils[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggleUtil(key)}
              aria-pressed={on}
              className="group flex items-center gap-[7px] text-left"
            >
              <span
                className={cn(
                  'flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full border transition-all duration-200',
                  on
                    ? 'border-[#d4b483]/58 bg-[#d4b483]/12 text-[#e2cba0]'
                    : 'border-[#a89e8c]/34 bg-black/36 text-[#9d9585]/80 group-hover:border-[#d4b483]/45 group-hover:text-[#d6c8ad]',
                )}
              >
                <Icon className="h-[9px] w-[9px]" />
              </span>
              <span className="flex min-w-0 flex-col leading-[1.18]">
                <span className="whitespace-nowrap text-[6.5px] tracking-[0.13em] text-[#b6ad9c]/84 group-hover:text-[#e0d7c6]">
                  {label}
                </span>
                {sub && (
                  <span className="whitespace-nowrap text-[6.5px] tracking-[0.13em] text-[#8f8778]/62">
                    {sub}
                  </span>
                )}
              </span>
              {key === 'camPreset' || key === 'cameraFocus' ? <Toggle on={on} className="ml-auto hidden" /> : null}
            </button>
          );
        })}
      </div>
      )}

      {/* ── body pose ─────────────────────────────────────────────────
          POSE toggles this rail. It sits directly under the utilities rather
          than in the asset popover: a pose is a viewport state, not a choice
          of supplied file, and the tiles have to be readable while the user
          looks at the body they are posing. */}
      {primaryTab !== 'HAIR' && utils.poseEdit && (
        <div className="mt-[13px]">
          <PosePanel />
        </div>
      )}

      {/* ── metric overlay ─────────────────────────────────────────
          Only meaningful on the face sections; hidden with the utilities. */}
      {primaryTab !== 'HAIR' && (
      <div className="mt-[13px] flex items-center gap-[7px]">
        <button
          type="button"
          onClick={() => setShowMesh(!showMesh)}
          aria-pressed={showMesh}
          className="group flex items-center gap-[7px]"
        >
          <span
            className={cn(
              'flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full border transition-all duration-200',
              showMesh
                ? 'border-[#4fd1c5]/58 bg-[#4fd1c5]/12 text-[#9ff3ec]'
                : 'border-[#a89e8c]/34 bg-black/36 text-[#9d9585]/80 group-hover:border-[#4fd1c5]/45',
            )}
          >
            <IconCheck className="h-[9px] w-[9px]" />
          </span>
          <span className="flex min-w-0 flex-col leading-[1.18]">
            <span className="whitespace-nowrap text-[6.5px] tracking-[0.13em] text-[#b6ad9c]/84 group-hover:text-[#e0d7c6]">
              METRIC MESH
            </span>
            <span className="whitespace-nowrap text-[6.5px] tracking-[0.13em] text-[#8f8778]/62">
              {showMesh ? 'VISIBLE' : 'HIDDEN'}
            </span>
          </span>
        </button>
      </div>
      )}

      {/* ── hair styles ────────────────────────────────────────────── */}
      {primaryTab === 'HAIR' && (
        <div className="mt-[3px]">
          <HairStyles manifest={manifest} />
        </div>
      )}

      {/* ── face shape ───────────────────────────────────────────────
          Its own section rather than a block under the utilities: the region
          cards are the sculpt controller, and having them permanently under
          the asset popover made it look like another asset list. */}
      {primaryTab === 'FACE SHAPE' && (
      <div className="mt-[19px]">
        <SectionTitle>FACE SHAPE</SectionTitle>

        <div className="mb-[9px] flex items-center gap-[15px] text-[7.5px] tracking-[0.1em]">
          <button
            type="button"
            onClick={() => setBisymmetry(!bisymmetry)}
            className="group flex items-center gap-[7px]"
            aria-pressed={bisymmetry}
          >
            <span
              className={cn(
                'flex h-[10px] w-[10px] items-center justify-center border transition-all duration-200',
                bisymmetry
                  ? 'border-[#d8b273] bg-[#d8b273]/86 text-[#231a10]'
                  : 'border-[#9a9181]/55 bg-black/34 text-transparent',
              )}
            >
              <IconCheck className="h-[8px] w-[8px]" />
            </span>
            <span className={bisymmetry ? 'text-[#e5d7bc]' : 'text-[#a29a8b]/72'}>Bisymmetry</span>
          </button>

          <button
            type="button"
            onClick={() => setAsymmetry(!asymmetry)}
            className="group flex items-center gap-[7px]"
            aria-pressed={asymmetry}
          >
            <span
              className={cn(
                'flex h-[10px] w-[10px] items-center justify-center border transition-all duration-200',
                asymmetry
                  ? 'border-[#d8b273] bg-[#d8b273]/86 text-[#231a10]'
                  : 'border-[#9a9181]/55 bg-black/34 text-transparent',
              )}
            >
              <IconCheck className="h-[8px] w-[8px]" />
            </span>
            <span className={asymmetry ? 'text-[#e5d7bc]' : 'text-[#a29a8b]/72'}>Asymmetry</span>
          </button>
        </div>

        {/* Region cards. Reference: 3 × 54 px tiles on a 114 px pitch
            (71 → 293), 82 px tall, labels ~10 px beneath. */}
        <div className="grid grid-cols-3 justify-items-center gap-x-[29px] gap-y-[13px]">
          {REGIONS.map((r) => {
            const active = activeRegion === r.id;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setActiveRegion(r.id)}
                aria-pressed={active}
                className="group flex flex-col items-center"
              >
                <span
                  className={cn(
                    'relative flex h-[82px] w-[54px] items-center justify-center overflow-hidden border transition-all duration-200',
                    active
                      ? 'border-[#d4b483]/78 bg-[#d9c19a]/[0.07] shadow-[0_0_16px_rgba(212,180,131,0.2),inset_0_0_20px_rgba(212,180,131,0.06)]'
                      : 'border-[#d4b483]/22 bg-[#0b0a08]/58 group-hover:border-[#d4b483]/46 group-hover:bg-[#171310]/62',
                  )}
                >
                  <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_38%,rgba(90,78,58,0.34),rgba(8,8,8,0.62))]" />
                  <FaceDiagram
                    kind={r.diagram}
                    className={cn(
                      'relative h-[68px] w-[46px] transition-opacity duration-200',
                      active ? 'opacity-100' : 'opacity-80 group-hover:opacity-100',
                    )}
                  />
                </span>
                <span
                  className={cn(
                    'mt-[5px] whitespace-nowrap text-center text-[6.5px] leading-[1.24] tracking-[0.09em] transition-colors',
                    active ? 'text-[#e8dcc2]' : 'text-[#a9a192]/78 group-hover:text-[#d5ccbb]',
                  )}
                >
                  {r.id === 'nose' ? (
                    <>
                      NOSE <span className="text-[#e8dcc2]">[ACTIVE]</span>
                    </>
                  ) : r.id === 'cheeks' ? (
                    <>
                      HIGHLIGHTED
                      <br />
                      ACTIVE BONE
                    </>
                  ) : r.id === 'jaw' ? (
                    <>
                      JAWLINE
                      <br />
                      CHIN
                    </>
                  ) : (
                    r.label
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      )}

      {/* ── presets ──────────────────────────────────────────────── */}
      {primaryTab === 'FACE SHAPE' && (
      <div className="mt-[16px]">
        <SectionTitle>PRESET FACE SHAPE</SectionTitle>
        {/* Reference: four 38 px tiles at a 62 px pitch (70 → 294) */}
        <div className="grid grid-cols-4 justify-items-center gap-x-[24px]">
          {PRESETS.map((p, i) => {
            const active = preset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p.id)}
                aria-pressed={active}
                title={p.label}
                className="group flex flex-col items-center gap-[4px]"
              >
                <span
                  className={cn(
                    'relative block h-[52px] w-[38px] overflow-hidden border transition-all duration-200',
                    active
                      ? 'border-[#d8be8c] shadow-[0_0_14px_rgba(216,190,140,0.28)]'
                      : 'border-[#d4b483]/24 group-hover:border-[#d4b483]/55',
                  )}
                >
                  <PresetThumb seed={p.seed} index={i} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
      )}

      <div className="mt-[12px] flex items-center gap-[5px] text-[6px] tracking-[0.15em] text-[#8b8375]/45">
        <IconSparkle className="h-[7px] w-[7px] text-[#c9b184]/60" />
        <span>SKYRIM SE · RACEMENU · XPMSSE</span>
      </div>
    </aside>
  );
}

/** Tiny vector portrait used for the preset thumbnails. */
function PresetThumb({ seed, index }: { seed: number; index: number }) {
  const faceTones = ['#d8bda6', '#cfa992', '#e0c4ad', '#d2b39b'];
  const hairTones = ['#2a1f1a', '#33241c', '#241a16', '#3a2a20'];
  const jaw = 0.86 + seed * 0.18;
  const cheek = 0.9 + seed * 0.14;

  return (
    <svg viewBox="0 0 64 72" className="h-full w-full" aria-hidden>
      <defs>
        <linearGradient id={`pt-bg-${index}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#211a15" />
          <stop offset="100%" stopColor="#0c0a09" />
        </linearGradient>
        <radialGradient id={`pt-light-${index}`} cx="42%" cy="30%" r="62%">
          <stop offset="0%" stopColor="rgba(255,224,190,0.30)" />
          <stop offset="100%" stopColor="rgba(255,224,190,0)" />
        </radialGradient>
      </defs>
      <rect width="64" height="72" fill={`url(#pt-bg-${index})`} />
      <rect width="64" height="72" fill={`url(#pt-light-${index})`} />
      {/* shoulders */}
      <path d="M8 72c1-10 9-15 24-15s23 5 24 15z" fill="#171310" />
      {/* neck */}
      <path d="M26 46h12v12c0 3-3 5-6 5s-6-2-6-5z" fill={faceTones[index % 4]} opacity="0.72" />
      {/* hair mass */}
      <path
        d={`M32 8c-10 0-16 6-16 15 0 3 .5 5 1 7-.5 -6 2-10 5-11 3-1 7-1 10 0 3-1 7-1 10 0 3 1 5.5 5 5 11 .5-2 1-4 1-7 0-9-6-15-16-15z`}
        fill={hairTones[index % 4]}
      />
      {/* face */}
      <path
        d={`M32 14c-6.4 0-10.4 4.2-10.4 10.6 0 3.2 .7 5.8 1.8 8 1 2 1.7 4 1.8 ${6.2 * jaw} .1 1.8 .1 3.6 0 5.4-.1 1.6 1 2.8 2.4 2.8h8.8c1.4 0 2.5-1.2 2.4-2.8-.1-1.8-.1-3.6 0-5.4 .1-2.2 .8-4.2 1.8-${6.2 * jaw} 1.1-2.2 1.8-4.8 1.8-8 0-6.4-4-10.6-10.4-10.6z`}
        fill={faceTones[index % 4]}
      />
      {/* shadow side */}
      <path
        d={`M32 14c-6.4 0-10.4 4.2-10.4 10.6 0 3.2 .7 5.8 1.8 8 1 2 1.7 4 1.8 ${6.2 * jaw} .1 1.8 .1 3.6 0 5.4-.1 1.6 1 2.8 2.4 2.8H32z`}
        fill="#4a2f26"
        opacity="0.22"
      />
      {/* brows */}
      <path d="M24.6 28.4c1.6-1.1 3.4-1.5 4.6-1.4" stroke="#33221b" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <path d="M39.4 28.4c-1.6-1.1-3.4-1.5-4.6-1.4" stroke="#33221b" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      {/* eyes */}
      <path d="M25.4 32.2c1.3-1.5 3.4-1.5 4.7 0-1.3 1.4-3.4 1.4-4.7 0z" fill="#241c18" />
      <path d="M38.6 32.2c-1.3-1.5-3.4-1.5-4.7 0 1.3 1.4 3.4 1.4 4.7 0z" fill="#241c18" />
      <circle cx="27.8" cy="32.2" r="0.9" fill="#5d5545" />
      <circle cx="36.2" cy="32.2" r="0.9" fill="#5d5545" />
      {/* nose + lips */}
      <path d="M32 33.4v4.4c0 .7-.4 1.1-1 1.4" stroke="#a97f68" strokeWidth="0.7" fill="none" opacity="0.7" />
      <path d="M29.4 42.6c1.1-.7 2.4-1 3.4-.6 1-.4 2.3-.1 3.4.6-1.1 .9-2.4 1.3-3.4 1.3s-2.3-.4-3.4-1.3z" fill="#a4675c" opacity="0.85" />
      {/* cheek light */}
      <ellipse cx={32 - 7 * cheek} cy="36" rx="3.4" ry="2.6" fill="#f0c9ad" opacity="0.10" />
      <ellipse cx={32 + 7 * cheek} cy="36" rx="3.4" ry="2.6" fill="#f0c9ad" opacity="0.06" />
    </svg>
  );
}
