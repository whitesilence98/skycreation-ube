'use client';

import { useCharacter, BODY_WEIGHT_ENABLED } from '@/lib/store';
import { ANATOMY_PARAMS, type AnatomyParamId } from '@/lib/anatomy/params';
import { hasBodyScale } from '@/lib/anatomy/bodyScale';
import { HudSlider } from '@/components/hud/HudSlider';
import { IconSparkle } from '@/components/hud/Icons';
import { cn } from '@/lib/cn';
import type { Mo2Manifest } from '@/lib/head/faceTexture';

/** The body-build sliders grouped into 2 ergonomic sections (RaceMenu parity). */
const PROPORTION_SLIDERS: { id: AnatomyParamId; customLabel?: string }[] = [
  { id: 'body.heightCm', customLabel: 'HEIGHT' },
  { id: 'body.headScale', customLabel: 'HEAD SCALE' },
  { id: 'body.armLength', customLabel: 'ARM LENGTH' },
  { id: 'body.legLength', customLabel: 'LEG LENGTH' },
  { id: 'body.shoulderWidth', customLabel: 'SHOULDER WIDTH' },
];

const SILHOUETTE_SLIDERS: { id: AnatomyParamId; customLabel?: string }[] = [
  { id: 'body.chestSize', customLabel: 'CHEST & BUST' },
  { id: 'body.waistSize', customLabel: 'WAIST TAPER' },
  { id: 'body.hipWidth', customLabel: 'HIP WIDTH' },
  { id: 'body.buttSize', customLabel: 'BUTT VOLUME' },
  { id: 'body.thighWidth', customLabel: 'THIGH FULLNESS' },
  { id: 'body.belly', customLabel: 'BELLY SOFTNESS' },
  { id: 'body.fat', customLabel: 'BODY FAT' },
];

function BodyShapeSlider({ id, customLabel }: { id: AnatomyParamId; customLabel?: string }) {
  const value = useCharacter((s) => s.anatomy[id]);
  const p = ANATOMY_PARAMS.find((entry) => entry.id === id)!;
  const s = useCharacter.getState;
  const isHeight = id === 'body.heightCm';
  return (
    <HudSlider
      label={customLabel ?? p.label}
      min={p.min}
      max={p.max}
      step={p.step}
      value={value}
      display={isHeight ? `${Math.round(value)} cm` : String(Math.round(value))}
      onChange={(v) => s().setAnatomy(id, v)}
      onActiveChange={(active) => (active ? s().beginAnatomyEdit() : s().endAnatomyEdit())}
      bracketed
    />
  );
}

interface BodyPanelProps {
  manifest?: Mo2Manifest | null;
}

export function BodyPanel({ manifest = null }: BodyPanelProps) {
  const weight = useCharacter((s) => s.weight);
  const setWeight = useCharacter((s) => s.setWeight);
  const linkFaceToWeight = useCharacter((s) => s.linkFaceToWeight);
  const setLinkFaceToWeight = useCharacter((s) => s.setLinkFaceToWeight);
  const garmentVisible = useCharacter((s) => s.garmentVisible);
  const setGarmentVisible = useCharacter((s) => s.setGarmentVisible);
  const skinGloss = useCharacter((s) => s.skinGloss);
  const setSkinGloss = useCharacter((s) => s.setSkinGloss);
  const skinSss = useCharacter((s) => s.skinSss);
  const setSkinSss = useCharacter((s) => s.setSkinSss);
  const bodyPhysicsEnabled = useCharacter((s) => s.bodyPhysicsEnabled);
  const triggerPhysicsImpulse = useCharacter((s) => s.triggerPhysicsImpulse);
  const workspace = useCharacter((s) => s.workspace);
  const setWorkspace = useCharacter((s) => s.setWorkspace);

  const hasBodyPair = Boolean(
    (manifest?.assets?.bodyMesh as Array<{ weightVariants?: unknown }> | undefined)
      ?.some((row) => row.weightVariants),
  );

  return (
    <div className="flex flex-col gap-3">
      {/* ── Top Header: Section title & status (blends natively into panel) ── */}
      <div className="flex items-center justify-between border-b border-[#d4b483]/14 pb-1">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-[#efece6]">
          BODY PHYSIQUE
        </span>
        <span className="font-mono text-[10px] text-[#a49a88]">
          {!BODY_WEIGHT_ENABLED ? '0% (LOCKED)' : `${Math.round(weight * 100)}% WEIGHT`}
        </span>
      </div>

      {/* ── 0A. Proportions & Stature ────────────────────────────── */}
      <div className="flex flex-col gap-1 border-b border-[#d4b483]/10 pb-2.5">
        <div className="mb-1 flex items-center justify-between border-b border-[#d4b483]/14 pb-1">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-[#efece6] leading-tight">
            PROPORTIONS &amp; STATURE
          </span>
          <span className="font-mono text-[10px] text-[#a49a88] leading-tight">SKELETON SCALE</span>
        </div>
        {PROPORTION_SLIDERS.map((s) => (
          <BodyShapeSlider key={s.id} id={s.id} customLabel={s.customLabel} />
        ))}
      </div>

      {/* ── 0B. Curvature & Silhouette ───────────────────────────── */}
      <div className="flex flex-col gap-1 border-b border-[#d4b483]/10 pb-2.5">
        <div className="mb-1 flex items-center justify-between border-b border-[#d4b483]/14 pb-1">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-[#efece6] leading-tight">
            CURVATURE &amp; SILHOUETTE
          </span>
          <span className="font-mono text-[10px] text-[#a49a88] leading-tight">VOLUME &amp; PROFILE</span>
        </div>
        {SILHOUETTE_SLIDERS.map((s) => (
          <BodyShapeSlider key={s.id} id={s.id} customLabel={s.customLabel} />
        ))}
        <p className="mt-1 text-[10px] leading-relaxed text-[#a49a88]">
          Bone-transform scaling (RaceMenu parity). 50 = baseline unchanged.
        </p>
      </div>

      {/* ── 1. Body Weight Slider (0–100% lerp) ────────────────────── */}
      <div className="flex flex-col gap-1.5 border-b border-[#d4b483]/10 pb-2.5">
        <HudSlider
          label="BODY WEIGHT"
          suffix={!BODY_WEIGHT_ENABLED ? '(LOCKED AT 0%)' : hasBodyPair ? undefined : '(SINGLE MESH)'}
          min={0}
          max={1}
          step={0.01}
          value={weight}
          disabled={!BODY_WEIGHT_ENABLED || !hasBodyPair}
          display={!BODY_WEIGHT_ENABLED ? '0% (DISABLED)' : `${Math.round(weight * 100)}% (${weight.toFixed(2)})`}
          onChange={(v) => {
            if (BODY_WEIGHT_ENABLED && hasBodyPair) setWeight(v);
          }}
          bracketed
        />

        {/* Quick Weight Preset Buttons */}
        <div className="mt-1 flex items-center justify-between gap-1.5 text-[10px] font-mono leading-none">
          <button
            type="button"
            disabled={!BODY_WEIGHT_ENABLED}
            onClick={() => setWeight(0)}
            className={cn(
              'flex-1 rounded-[2px] border py-1 tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed',
              weight === 0
                ? 'border-[#eac87f] bg-[#d4b483]/25 font-bold text-[#f2dfbe] shadow-[0_0_6px_rgba(234,200,127,0.3)]'
                : 'border-[#d4b483]/25 bg-black/40 text-[#a9a192]/80 hover:border-[#d4b483]/50 hover:text-[#d5ccbb]',
            )}
          >
            SLIM [0%]
          </button>
          <button
            type="button"
            disabled={!BODY_WEIGHT_ENABLED}
            onClick={() => setWeight(0.5)}
            className={cn(
              'flex-1 rounded-[2px] border py-1 tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed',
              Math.abs(weight - 0.5) < 0.02
                ? 'border-[#eac87f] bg-[#d4b483]/25 font-bold text-[#f2dfbe] shadow-[0_0_6px_rgba(234,200,127,0.3)]'
                : 'border-[#d4b483]/25 bg-black/40 text-[#a9a192]/80 hover:border-[#d4b483]/50 hover:text-[#d5ccbb]',
            )}
          >
            MEDIUM [50%]
          </button>
          <button
            type="button"
            disabled={!BODY_WEIGHT_ENABLED}
            onClick={() => setWeight(1)}
            className={cn(
              'flex-1 rounded-[2px] border py-1 tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed',
              weight === 1
                ? 'border-[#eac87f] bg-[#d4b483]/25 font-bold text-[#f2dfbe] shadow-[0_0_6px_rgba(234,200,127,0.3)]'
                : 'border-[#d4b483]/25 bg-black/40 text-[#a9a192]/80 hover:border-[#d4b483]/50 hover:text-[#d5ccbb]',
            )}
          >
            FULL [100%]
          </button>
        </div>

        {/* Link Face to Weight */}
        <button
          type="button"
          onClick={() => setLinkFaceToWeight(!linkFaceToWeight)}
          title="FaceGen fullness and neck perimeter scale with body weight (Skyrim Creation Engine parity)"
          className={cn(
            'mt-1.5 flex w-full items-center justify-between border px-2 py-1.5 text-[10px] font-mono tracking-wider leading-tight transition-colors',
            linkFaceToWeight
              ? 'border-[#eac87f] bg-[#d4b483]/16 text-[#f2dfbe] font-medium shadow-[0_0_8px_rgba(212,180,131,0.2)]'
              : 'border-[#8c8477]/30 bg-black/30 text-[#a8a294]/70 hover:border-[#d4b483]/50 hover:text-[#d5cdbd]',
          )}
        >
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                'inline-block h-1.5 w-1.5 rounded-full transition-colors',
                linkFaceToWeight ? 'bg-[#eac87f] shadow-[0_0_5px_#eac87f]' : 'bg-[#8c8477]/40',
              )}
            />
            LINK FACE TO WEIGHT
          </span>
          <span className="text-[10px] font-medium uppercase text-[#c9b184] leading-tight">
            {linkFaceToWeight ? 'ACTIVE' : 'OFF'}
          </span>
        </button>
      </div>

      {/* ── 2. Garment Layer Toggle (Anatomy vs Clothing) ─────────── */}
      <div className="flex items-center justify-between border-b border-[#d4b483]/10 pb-2.5">
        <div className="flex flex-col">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-[#efece6] leading-tight">
            GARMENT LAYER
          </span>
          <span className="text-[10px] text-[#a49a88] leading-tight">
            {garmentVisible ? 'Outfits visible on model' : 'Hiding clothes for anatomy inspection'}
          </span>
        </div>

        <button
          type="button"
          onClick={() => setGarmentVisible(!garmentVisible)}
          className={cn(
            'flex items-center gap-1.5 rounded-[2px] border px-2.5 py-1 text-[10px] font-mono tracking-wider leading-tight transition-all',
            garmentVisible
              ? 'border-[#eac87f] bg-[#d4b483]/20 text-[#f2dfbe] shadow-[0_0_6px_rgba(234,200,127,0.3)]'
              : 'border-[#d09e88]/50 bg-[#d09e88]/15 text-[#e0a898]',
          )}
        >
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              garmentVisible ? 'bg-[#eac87f] shadow-[0_0_4px_#eac87f]' : 'bg-[#e0a898]',
            )}
          />
          <span>{garmentVisible ? 'OUTFIT ON' : 'ANATOMY ONLY'}</span>
        </button>
      </div>

      {/* ── 3. Skin Material Gloss & SSS ─────────────────────────── */}
      <div className="flex flex-col gap-2 border-b border-[#d4b483]/10 pb-2.5">
        <div className="flex items-center justify-between border-b border-[#d4b483]/14 pb-1">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-[#efece6] leading-tight">
            SKIN SHADER METRICS
          </span>
          <span className="font-mono text-[10px] text-[#a49a88] leading-tight">SSS / GLOSS</span>
        </div>

        <div className="flex flex-col gap-2">
          <div>
            <div className="mb-0.5 flex justify-between text-[10px] font-mono leading-tight">
              <span className="text-[#a9a192]">SKIN GLOSS</span>
              <span className="text-[#eac87f]">{Math.round(skinGloss * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={skinGloss}
              onChange={(e) => setSkinGloss(parseFloat(e.target.value))}
              className="h-1 w-full cursor-pointer appearance-none rounded-full bg-[#201d18] accent-[#eac87f]"
            />
          </div>

          <div>
            <div className="mb-0.5 flex justify-between text-[10px] font-mono leading-tight">
              <span className="text-[#a9a192]">SUBSURFACE SCATTERING</span>
              <span className="text-[#eac87f]">{Math.round(skinSss * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={skinSss}
              onChange={(e) => setSkinSss(parseFloat(e.target.value))}
              className="h-1 w-full cursor-pointer appearance-none rounded-full bg-[#201d18] accent-[#eac87f]"
            />
          </div>
        </div>
      </div>

      {/* ── 4. CBPC Physics Launcher Card ─────────────────────────── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between border-b border-[#d4b483]/14 pb-1">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-[#efece6] leading-tight">
              CBPC SOFT-BODY PHYSICS
            </span>
          </div>
          <span className={cn('font-mono text-[10px] leading-tight', bodyPhysicsEnabled ? 'text-[#eac87f]' : 'text-[#8f8778]')}>
            {bodyPhysicsEnabled ? 'ENABLED' : 'OFF'}
          </span>
        </div>

        <div className="mt-1 flex items-center gap-1.5">
          <button
            type="button"
            onClick={triggerPhysicsImpulse}
            title="Trigger a momentary impulse to preview physics bounce"
            className="flex-1 rounded-[2px] border border-[#d4b483]/30 bg-black/40 py-1.5 font-mono text-[10px] tracking-wider leading-tight text-[#d8c9ad] transition-all hover:border-[#eac87f] hover:text-[#fff0d4]"
          >
            TEST BOUNCE
          </button>

          <button
            type="button"
            onClick={() => setWorkspace(workspace === 'physics' ? 'edit' : 'physics')}
            className={cn(
              'flex-1 rounded-[2px] border py-1.5 font-mono text-[10px] tracking-wider leading-tight transition-all',
              workspace === 'physics'
                ? 'border-[#eac87f] bg-[#d4b483]/25 font-bold text-[#f2dfbe] shadow-[0_0_8px_rgba(234,200,127,0.35)]'
                : 'border-[#d4b483]/35 bg-[#d4b483]/12 text-[#e8c98e] hover:border-[#eac87f] hover:bg-[#d4b483]/22 hover:text-[#fff0d4]',
            )}
          >
            <span>{workspace === 'physics' ? 'CLOSE [ESC]' : 'PHYSICS STUDIO →'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
