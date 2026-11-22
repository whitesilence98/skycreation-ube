'use client';

import { useCharacter, BODY_WEIGHT_ENABLED } from '@/lib/store';
import { BODY_POSES } from '@/lib/character/poses';
import { StudioCard } from '@/components/hud/common/StudioCard';
import { BracketSlider } from '@/components/hud/common/BracketSlider';
import { cn } from '@/lib/cn';
import type { Mo2Manifest } from '@/lib/head/faceTexture';

interface BodyPropertiesProps {
  manifest?: Mo2Manifest | null;
  onClose?: () => void;
}

export function BodyProperties({ manifest = null, onClose }: BodyPropertiesProps) {
  const weight = useCharacter((s) => s.weight);
  const setWeight = useCharacter((s) => s.setWeight);
  const linkFaceToWeight = useCharacter((s) => s.linkFaceToWeight);
  const setLinkFaceToWeight = useCharacter((s) => s.setLinkFaceToWeight);
  const garmentVisible = useCharacter((s) => s.garmentVisible);
  const setGarmentVisible = useCharacter((s) => s.setGarmentVisible);
  const bodyPhysicsEnabled = useCharacter((s) => s.bodyPhysicsEnabled);
  const setBodyPhysicsEnabled = useCharacter((s) => s.setBodyPhysicsEnabled);
  const bodyPhysicsBounciness = useCharacter((s) => s.bodyPhysicsBounciness);
  const setBodyPhysicsBounciness = useCharacter((s) => s.setBodyPhysicsBounciness);
  const bodyCollisionsEnabled = useCharacter((s) => s.bodyCollisionsEnabled);
  const setBodyCollisionsEnabled = useCharacter((s) => s.setBodyCollisionsEnabled);
  const triggerPhysicsImpulse = useCharacter((s) => s.triggerPhysicsImpulse);
  const secondaryPhysicsEnabled = useCharacter((s) => s.secondaryPhysicsEnabled);
  const setSecondaryPhysicsEnabled = useCharacter((s) => s.setSecondaryPhysicsEnabled);
  const hairPhysicsEnabled = useCharacter((s) => s.hairPhysicsEnabled);
  const setHairPhysicsEnabled = useCharacter((s) => s.setHairPhysicsEnabled);
  const clothPhysicsEnabled = useCharacter((s) => s.clothPhysicsEnabled);
  const setClothPhysicsEnabled = useCharacter((s) => s.setClothPhysicsEnabled);
  const secondaryStiffness = useCharacter((s) => s.secondaryStiffness);
  const setSecondaryStiffness = useCharacter((s) => s.setSecondaryStiffness);
  const secondaryDamping = useCharacter((s) => s.secondaryDamping);
  const setSecondaryDamping = useCharacter((s) => s.setSecondaryDamping);
  const secondaryWindIntensity = useCharacter((s) => s.secondaryWindIntensity);
  const setSecondaryWindIntensity = useCharacter((s) => s.setSecondaryWindIntensity);
  const triggerSecondaryImpulse = useCharacter((s) => s.triggerSecondaryImpulse);
  const bodyPoseId = useCharacter((s) => s.bodyPoseId);
  const setBodyPose = useCharacter((s) => s.setBodyPose);
  const toggleUtil = useCharacter((s) => s.toggleUtil);
  const setWorkspace = useCharacter((s) => s.setWorkspace);

  const hasBodyPair = Boolean(
    (manifest?.assets?.bodyMesh as Array<{ weightVariants?: unknown }> | undefined)
      ?.some((row) => row.weightVariants),
  );

  const content = (
    <div className="flex flex-col gap-3">

      {/* ── Body Weight Slider ──────────────────────────────────── */}
      <section className="mb-[16px]">
        <BracketSlider
          label="BODY WEIGHT"
          min={0}
          max={1}
          step={0.01}
          value={weight}
          disabled={!BODY_WEIGHT_ENABLED || !hasBodyPair}
          display={!BODY_WEIGHT_ENABLED ? '0% (DISABLED)' : `${Math.round(weight * 100)}%`}
          onChange={(v) => {
            if (BODY_WEIGHT_ENABLED && hasBodyPair) setWeight(v);
          }}
        />
        <p className="-mt-[8px] mb-[10px] text-[10px] leading-[1.5] text-[#a9a192]/65">
          {!BODY_WEIGHT_ENABLED
            ? 'Body weight adjustments are temporarily locked at 0% (slim _0 mesh).'
            : hasBodyPair
              ? 'Blends femalebody_0 (slim) → femalebody_1 (full muscular).'
              : 'Active body mesh ships no weight variants (_0/_1 pair).'}
        </p>

        {/* Link Face to Weight */}
        <button
          type="button"
          onClick={() => setLinkFaceToWeight(!linkFaceToWeight)}
          title="Link Face to Weight: FaceGen fullness and neck perimeter scale with body weight (Skyrim Creation Engine parity)"
          className={cn(
            'flex w-full items-center justify-between border px-[8px] py-[6px] text-[10px] tracking-[0.09em] transition-colors',
            linkFaceToWeight
              ? 'border-[#d4b483]/70 bg-[#d4b483]/14 text-[#e8c691] font-medium shadow-[0_0_10px_rgba(212,180,131,0.15)]'
              : 'border-[#8c8477]/30 bg-black/20 text-[#a8a294]/70 hover:border-[#d4b483]/45 hover:text-[#d5cdbd]',
          )}
        >
          <span className="flex items-center gap-[6px]">
            <span
              className={cn(
                'inline-block h-[5px] w-[5px] rounded-full transition-colors',
                linkFaceToWeight ? 'bg-[#d4b483] shadow-[0_0_6px_#d4b483]' : 'bg-[#8c8477]/40',
              )}
            />
            LINK FACE TO WEIGHT
          </span>
          <span className="num text-[10px] uppercase text-[#c9b184]/80">
            {linkFaceToWeight ? 'ACTIVE' : 'OFF'}
          </span>
        </button>
      </section>

      {/* ── Garment Visibility ──────────────────────────────────── */}
      <section className="mb-[16px] border-t border-[#d4b483]/15 pt-[12px]">
        <h4 className="mb-[6px] text-[10px] font-medium tracking-[0.12em] text-[#d8c9ad]">GARMENT LAYER</h4>
        <button
          type="button"
          onClick={() => setGarmentVisible(!garmentVisible)}
          aria-pressed={garmentVisible}
          className={cn(
            'flex w-full items-center justify-between border px-[8px] py-[6px] text-[10px] tracking-[0.09em] transition-colors',
            garmentVisible
              ? 'border-[#d4b483]/70 bg-[#d4b483]/14 text-[#e8c691] font-medium'
              : 'border-[#8c8477]/30 bg-black/20 text-[#a8a294]/70 hover:border-[#d4b483]/45 hover:text-[#d5cdbd]',
          )}
        >
          <span className="flex items-center gap-[6px]">
            <span
              className={cn(
                'inline-block h-[5px] w-[5px] rounded-full transition-colors',
                garmentVisible ? 'bg-[#d4b483] shadow-[0_0_6px_#d4b483]' : 'bg-[#8c8477]/40',
              )}
            />
            OUTFIT MESH VISIBLE
          </span>
          <span className="num text-[10px] uppercase text-[#c9b184]/80">
            {garmentVisible ? 'SHOWN' : 'HIDDEN'}
          </span>
        </button>
        <p className="mt-[6px] text-[10px] leading-[1.5] text-[#a9a192]/65">
          Toggles outfit/undergarment mesh while keeping base anatomy visible.
        </p>
      </section>

      {/* ── Soft Body Physics & Collisions (CBPC Style) ────────────── */}
      <section className="mb-[16px] border-t border-[#d4b483]/15 pt-[12px]">
        <div className="mb-[8px] flex items-center justify-between">
          <h4 className="text-[10px] font-medium tracking-[0.12em] text-[#d8c9ad]">
            PHYSICS &amp; DYNAMICS (CBPC)
          </h4>
          <button
            type="button"
            onClick={triggerPhysicsImpulse}
            disabled={!bodyPhysicsEnabled}
            title="Trigger a soft-body impulse to test breast and gluteal spring dynamics"
            className={cn(
              'border px-[6px] py-[2px] text-[10px] tracking-[0.08em] leading-tight transition-colors',
              bodyPhysicsEnabled
                ? 'border-[#d4b483]/60 bg-[#d4b483]/12 text-[#e8c691] hover:border-[#d4b483] hover:bg-[#d4b483]/22 active:scale-95'
                : 'border-[#8c8477]/20 bg-transparent text-[#8c8477]/40 cursor-not-allowed',
            )}
          >
            TEST JIGGLE ⟲
          </button>
        </div>

        {/* Soft-body Toggle */}
        <button
          type="button"
          onClick={() => setBodyPhysicsEnabled(!bodyPhysicsEnabled)}
          aria-pressed={bodyPhysicsEnabled}
          className={cn(
            'flex w-full items-center justify-between border px-[8px] py-[6px] text-[10px] tracking-[0.09em] transition-colors mb-[8px]',
            bodyPhysicsEnabled
              ? 'border-[#d4b483]/70 bg-[#d4b483]/14 text-[#e8c691] font-medium shadow-[0_0_10px_rgba(212,180,131,0.12)]'
              : 'border-[#8c8477]/30 bg-black/20 text-[#a8a294]/70 hover:border-[#d4b483]/45 hover:text-[#d5cdbd]',
          )}
        >
          <span className="flex items-center gap-[6px]">
            <span
              className={cn(
                'inline-block h-[5px] w-[5px] rounded-full transition-colors',
                bodyPhysicsEnabled ? 'bg-[#d4b483] shadow-[0_0_6px_#d4b483]' : 'bg-[#8c8477]/40',
              )}
            />
            SOFT BODY PHYSICS
          </span>
          <span className="num text-[10px] uppercase text-[#c9b184]/80">
            {bodyPhysicsEnabled ? 'ACTIVE' : 'OFF'}
          </span>
        </button>

        {bodyPhysicsEnabled && (
          <>
            <div className="mb-[8px]">
              <BracketSlider
                label="BOUNCINESS"
                min={0}
                max={1}
                step={0.05}
                value={bodyPhysicsBounciness}
                display={
                  bodyPhysicsBounciness < 0.3
                    ? `FIRM (${bodyPhysicsBounciness.toFixed(2)})`
                    : bodyPhysicsBounciness > 0.7
                      ? `SOFT (${bodyPhysicsBounciness.toFixed(2)})`
                      : `NATURAL (${bodyPhysicsBounciness.toFixed(2)})`
                }
                onChange={setBodyPhysicsBounciness}
              />
            </div>

            {/* Hand Collisions Toggle */}
            <button
              type="button"
              onClick={() => setBodyCollisionsEnabled(!bodyCollisionsEnabled)}
              aria-pressed={bodyCollisionsEnabled}
              className={cn(
                'flex w-full items-center justify-between border px-[8px] py-[5px] text-[10px] tracking-[0.09em] transition-colors',
                bodyCollisionsEnabled
                  ? 'border-[#d4b483]/50 bg-[#d4b483]/10 text-[#e8c691]'
                  : 'border-[#8c8477]/30 bg-black/20 text-[#a8a294]/70 hover:border-[#d4b483]/45 hover:text-[#d5cdbd]',
              )}
            >
              <span className="flex items-center gap-[6px]">
                <span
                  className={cn(
                    'inline-block h-[5px] w-[5px] rounded-full transition-colors',
                    bodyCollisionsEnabled ? 'bg-[#d4b483] shadow-[0_0_6px_#d4b483]' : 'bg-[#8c8477]/40',
                  )}
                />
                HAND / LIMB COLLISIONS
              </span>
              <span className="num text-[10px] uppercase text-[#c9b184]/80">
                {bodyCollisionsEnabled ? 'ON' : 'OFF'}
              </span>
            </button>
            <p className="mt-[6px] text-[10px] leading-[1.5] text-[#a9a192]/65">
              Prevents hands and arms from clipping into the chest and hips in poses.
            </p>
          </>
        )}
      </section>

      {/* ── Secondary Physics (SMP Hair & Garments) ─────────────── */}
      <section className="mb-[16px] border-t border-[#d4b483]/15 pt-[12px]">
        <div className="mb-[8px] flex items-center justify-between">
          <h4 className="text-[10px] font-medium tracking-[0.12em] text-[#d8c9ad]">
            SECONDARY DYNAMICS (SMP / SPRINGBONE)
          </h4>
          <button
            type="button"
            onClick={triggerSecondaryImpulse}
            disabled={!secondaryPhysicsEnabled}
            title="Trigger dynamic inertia to preview hair and skirt swing"
            className={cn(
              'border px-[6px] py-[2px] text-[10px] tracking-[0.08em] leading-tight transition-colors',
              secondaryPhysicsEnabled
                ? 'border-[#d4b483]/60 bg-[#d4b483]/12 text-[#e8c691] hover:border-[#d4b483] hover:bg-[#d4b483]/22 active:scale-95'
                : 'border-[#8c8477]/20 bg-transparent text-[#8c8477]/40 cursor-not-allowed',
            )}
          >
            TEST SWAY ⟲
          </button>
        </div>

        {/* Global Secondary Toggle */}
        <button
          type="button"
          onClick={() => setSecondaryPhysicsEnabled(!secondaryPhysicsEnabled)}
          aria-pressed={secondaryPhysicsEnabled}
          className={cn(
            'flex w-full items-center justify-between border px-[8px] py-[6px] text-[10px] tracking-[0.09em] transition-colors mb-[8px]',
            secondaryPhysicsEnabled
              ? 'border-[#d4b483]/70 bg-[#d4b483]/14 text-[#e8c691] font-medium shadow-[0_0_10px_rgba(212,180,131,0.12)]'
              : 'border-[#8c8477]/30 bg-black/20 text-[#a8a294]/70 hover:border-[#d4b483]/45 hover:text-[#d5cdbd]',
          )}
        >
          <span className="flex items-center gap-[6px]">
            <span
              className={cn(
                'inline-block h-[5px] w-[5px] rounded-full transition-colors',
                secondaryPhysicsEnabled ? 'bg-[#d4b483] shadow-[0_0_6px_#d4b483]' : 'bg-[#8c8477]/40',
              )}
            />
            SECONDARY PHYSICS ENGINE
          </span>
          <span className="num text-[10px] uppercase text-[#c9b184]/80">
            {secondaryPhysicsEnabled ? 'ACTIVE' : 'OFF'}
          </span>
        </button>

        {secondaryPhysicsEnabled && (
          <div className="flex flex-col gap-2">
            {/* Sub-toggles for Hair & Cloth */}
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setHairPhysicsEnabled(!hairPhysicsEnabled)}
                aria-pressed={hairPhysicsEnabled}
                className={cn(
                  'flex items-center justify-between border px-[6px] py-[5px] text-[9px] tracking-wider transition-colors',
                  hairPhysicsEnabled
                    ? 'border-[#d4b483]/60 bg-[#d4b483]/12 text-[#e8c691]'
                    : 'border-[#8c8477]/30 bg-black/20 text-[#8c8477]/60 hover:text-white',
                )}
              >
                <span>HAIR SWAY</span>
                <span className="text-[#c9b184]">{hairPhysicsEnabled ? 'ON' : 'OFF'}</span>
              </button>

              <button
                type="button"
                onClick={() => setClothPhysicsEnabled(!clothPhysicsEnabled)}
                aria-pressed={clothPhysicsEnabled}
                className={cn(
                  'flex items-center justify-between border px-[6px] py-[5px] text-[9px] tracking-wider transition-colors',
                  clothPhysicsEnabled
                    ? 'border-[#d4b483]/60 bg-[#d4b483]/12 text-[#e8c691]'
                    : 'border-[#8c8477]/30 bg-black/20 text-[#8c8477]/60 hover:text-white',
                )}
              >
                <span>CLOTH FLOW</span>
                <span className="text-[#c9b184]">{clothPhysicsEnabled ? 'ON' : 'OFF'}</span>
              </button>
            </div>

            {/* Elasticity / Stiffness Slider */}
            <div className="mt-1">
              <BracketSlider
                label="FLEXIBILITY / BOUNCE"
                min={0.1}
                max={0.9}
                step={0.05}
                value={1 - secondaryStiffness}
                display={`${Math.round((1 - secondaryStiffness) * 100)}%`}
                onChange={(v) => setSecondaryStiffness(1 - v)}
              />
            </div>

            {/* Ambient Wind Drift */}
            <div>
              <BracketSlider
                label="AMBIENT WIND SWAY"
                min={0}
                max={1}
                step={0.05}
                value={secondaryWindIntensity}
                display={secondaryWindIntensity === 0 ? 'CALM' : `${Math.round(secondaryWindIntensity * 100)}%`}
                onChange={setSecondaryWindIntensity}
              />
            </div>
            <p className="mt-[2px] text-[10px] leading-[1.4] text-[#a9a192]/65">
              Simulates dynamic inertia, momentum, and collision avoidance on hair strands, skirts, cloaks, and robes.
            </p>
          </div>
        )}
      </section>

      {/* ── Quick Pose Presets ──────────────────────────────────── */}
      <section className="border-t border-[#d4b483]/15 pt-[12px]">
        <div className="mb-[6px] flex items-baseline justify-between">
          <h4 className="text-[10px] font-medium tracking-[0.12em] text-[#d8c9ad]">STANCE &amp; POSE</h4>
          <button
            type="button"
            onClick={() => {
              setWorkspace('poses');
            }}
            className="text-[10px] tracking-[0.08em] text-[#c9b184]/85 underline-offset-2 hover:underline hover:text-[#f0e6d4] leading-tight"
          >
            MORE POSES →
          </button>
        </div>
        <div className="grid grid-cols-2 gap-[4px]">
          {BODY_POSES.slice(0, 4).map((pose) => {
            const active = bodyPoseId === pose.id;
            return (
              <button
                key={pose.id}
                type="button"
                onClick={() => setBodyPose(pose.id)}
                aria-pressed={active}
                title={pose.note}
                className={cn(
                  'flex items-center justify-center border px-[4px] py-[6px] text-[10px] tracking-[0.1em] transition-colors',
                  active
                    ? 'border-[#d4b483] bg-[#d4b483]/16 text-[#f0e6d4] font-medium shadow-[0_0_8px_rgba(212,180,131,0.18)]'
                    : 'border-[#d4b483]/25 bg-black/20 text-[#a8a294]/75 hover:border-[#d4b483]/50 hover:text-[#d5cdbd]',
                )}
              >
                {pose.label}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );

  if (!onClose) {
    return content;
  }

  return (
    <StudioCard
      title="BODY & PHYSICS"
      badge="HDT-SMP"
      onClose={onClose}
      footerLeading={<span>+ UBE ANATOMY</span>}
      footerTrailing={<span>SMP ACTIVE</span>}
      showSparkle
    >
      {content}
    </StudioCard>
  );
}
