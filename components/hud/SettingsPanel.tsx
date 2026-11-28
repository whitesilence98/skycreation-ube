'use client';

import { useCharacter } from '@/lib/store';
import { useRenderStats } from '@/lib/perf';
import {
  useGraphicsSettings,
  type AnisotropyOption,
  type GraphicsPreset,
  type MaxFpsOption,
  type RenderScaleOption,
  type RoomPostFxOption,
  type ShadowQualityOption,
} from '@/lib/graphicsSettings';
import { StudioCard } from '@/components/hud/common/StudioCard';
import { cn } from '@/lib/cn';
import { IconGear, IconSparkle } from '@/components/hud/Icons';

const PRESET_OPTIONS: ReadonlyArray<{ id: Exclude<GraphicsPreset, 'custom'>; label: string }> = [
  { id: 'low', label: 'LOW' },
  { id: 'medium', label: 'MED' },
  { id: 'high', label: 'HIGH' },
];

const RENDER_SCALE_OPTIONS: ReadonlyArray<{ val: RenderScaleOption; label: string }> = [
  { val: 0.85, label: '0.85×' },
  { val: 1.0, label: '1.0×' },
  { val: 1.25, label: '1.25×' },
  { val: 1.5, label: '1.5×' },
];

const SHADOW_OPTIONS: ReadonlyArray<{ val: ShadowQualityOption; label: string }> = [
  { val: 'off', label: 'OFF' },
  { val: 'low', label: 'LOW' },
  { val: 'medium', label: 'MED' },
  { val: 'high', label: 'HIGH' },
];

const ANISO_OPTIONS: ReadonlyArray<{ val: AnisotropyOption; label: string }> = [
  { val: 1, label: '1×' },
  { val: 4, label: '4×' },
  { val: 8, label: '8×' },
];

const ROOM_FX_OPTIONS: ReadonlyArray<{ val: RoomPostFxOption; label: string }> = [
  { val: 'off', label: 'OFF' },
  { val: 'station', label: 'STATION' },
  { val: 'always', label: 'ALWAYS' },
];

const FPS_OPTIONS: ReadonlyArray<{ val: MaxFpsOption; label: string }> = [
  { val: 30, label: '30' },
  { val: 60, label: '60' },
  { val: 0, label: 'UNLIM' },
];

function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 border-t border-[#d4b483]/14 pt-2 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col min-w-0">
          <span className="text-[10px] font-medium tracking-wide text-[#d8c39c]">{label}</span>
          {hint && <span className="text-[10px] tracking-wide text-[#8f8778]">{hint}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-1">{children}</div>
      </div>
    </div>
  );
}

function PillOption({
  active,
  label,
  onClick,
  title,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={cn(
        'min-h-[24px] rounded-[2px] border px-1.5 font-mono text-[10px] tracking-wider transition-colors focus-visible:outline focus-visible:outline-[#eac87f]',
        active
          ? 'border-[#eac87f] bg-[#dfba73]/25 text-[#f7eedc] font-semibold'
          : 'border-white/15 bg-black/35 text-[#b4aea4] hover:border-[#dfba73]/50 hover:text-white',
      )}
    >
      {label}
    </button>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
  label: string;
  id?: string;
}) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-[20px] w-[36px] shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 focus:outline-none',
        checked
          ? 'border-[#eac87f] bg-[#d4b483]/30 shadow-[0_0_8px_rgba(234,200,127,0.35)]'
          : 'border-[#d4b483]/25 bg-black/50',
      )}
      aria-label={label}
    >
      <span
        className={cn(
          'inline-block h-[12px] w-[12px] rounded-full transition-transform duration-200',
          checked
            ? 'translate-x-[18px] bg-[#f2dfbe] shadow-[0_0_6px_rgba(234,200,127,0.8)]'
            : 'translate-x-[3px] bg-[#8f8778]',
        )}
      />
    </button>
  );
}

export interface SettingsPanelProps {
  onClose?: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps = {}) {
  const unrestrictedSlots = useCharacter((s) => s.unrestrictedSlots);
  const setUnrestrictedSlots = useCharacter((s) => s.setUnrestrictedSlots);
  const showGroundMeshes = useCharacter((s) => s.showGroundMeshes);
  const setShowGroundMeshes = useCharacter((s) => s.setShowGroundMeshes);

  const showMesh = useCharacter((s) => s.showMesh);
  const setShowMesh = useCharacter((s) => s.setShowMesh);
  const previewMode = useCharacter((s) => s.previewMode);
  const setPreviewMode = useCharacter((s) => s.setPreviewMode);

  const preset = useGraphicsSettings((s) => s.preset);
  const renderScale = useGraphicsSettings((s) => s.renderScale);
  const shadowQuality = useGraphicsSettings((s) => s.shadowQuality);
  const anisotropy = useGraphicsSettings((s) => s.anisotropy);
  const roomPostFx = useGraphicsSettings((s) => s.roomPostFx);
  const maxFps = useGraphicsSettings((s) => s.maxFps);
  const glassBlur = useGraphicsSettings((s) => s.glassBlur);
  const applyPreset = useGraphicsSettings((s) => s.applyPreset);
  const updateGraphics = useGraphicsSettings((s) => s.updateGraphics);
  const perf = useRenderStats();

  const cardSurface = cn(
    'flex flex-col gap-2 rounded-xs border border-[#d4b483]/22 bg-black/50 p-3',
    glassBlur && 'backdrop-blur-md',
  );

  return (
    <StudioCard
      title="SETTINGS"
      badge="GRAPHICS / SYSTEM"
      onClose={onClose ?? (() => useCharacter.getState().setWorkspace('edit'))}
      footerLeading={<span>+ ROOM &amp; STUDIO</span>}
      footerTrailing={<span>FPS {perf.fps || '—'}</span>}
      showSparkle
    >
      <div className="flex flex-col gap-3 font-mono max-h-[calc(100dvh-190px)] overflow-y-auto scrollbar-none">
        {/* ── Section: GRAPHICS & PERFORMANCE ────────────────────────── */}
        <div className={cardSurface}>
          <div className="flex items-center justify-between gap-2 border-b border-[#d4b483]/18 pb-1.5">
            <div className="flex items-center gap-2">
              <IconSparkle className="h-3.5 w-3.5 text-[#eac87f]" />
              <h3 className="text-[10px] font-medium tracking-[0.12em] text-[#efece6] uppercase">
                GRAPHICS &amp; PERFORMANCE
              </h3>
            </div>
            {preset === 'custom' && (
              <span className="rounded-[2px] border border-[#dfba73]/40 bg-[#dfba73]/12 px-1.5 py-0.5 text-[10px] text-[#eac87f]">
                CUSTOM
              </span>
            )}
          </div>

          <SettingRow label="QUALITY PRESET" hint="Applies to Room & Customize">
            {PRESET_OPTIONS.map((p) => (
              <PillOption
                key={p.id}
                label={p.label}
                active={preset === p.id}
                onClick={() => applyPreset(p.id)}
              />
            ))}
          </SettingRow>

          <SettingRow label="RENDER SCALE" hint="Canvas DPR resolution">
            {RENDER_SCALE_OPTIONS.map((o) => (
              <PillOption
                key={o.val}
                label={o.label}
                active={renderScale === o.val}
                onClick={() => updateGraphics({ renderScale: o.val })}
              />
            ))}
          </SettingRow>

          <SettingRow label="SHADOWS" hint="Off / 512 / 1024 / 2048 Soft">
            {SHADOW_OPTIONS.map((o) => (
              <PillOption
                key={o.val}
                label={o.label}
                active={shadowQuality === o.val}
                onClick={() => updateGraphics({ shadowQuality: o.val })}
              />
            ))}
          </SettingRow>

          <SettingRow label="TEXTURES" hint="Anisotropic sharpness">
            {ANISO_OPTIONS.map((o) => (
              <PillOption
                key={o.val}
                label={o.label}
                active={anisotropy === o.val}
                onClick={() => updateGraphics({ anisotropy: o.val })}
              />
            ))}
          </SettingRow>

          <SettingRow label="ROOM POST-FX" hint="Bloom & SMAA in Room">
            {ROOM_FX_OPTIONS.map((o) => (
              <PillOption
                key={o.val}
                label={o.label}
                active={roomPostFx === o.val}
                onClick={() => updateGraphics({ roomPostFx: o.val })}
              />
            ))}
          </SettingRow>

          <SettingRow label="FPS CAP" hint="Frame limiter">
            {FPS_OPTIONS.map((o) => (
              <PillOption
                key={o.val}
                label={o.label}
                active={maxFps === o.val}
                onClick={() => updateGraphics({ maxFps: o.val })}
              />
            ))}
          </SettingRow>

          <div className="flex items-center justify-between border-t border-[#d4b483]/14 pt-2">
            <div className="flex flex-col">
              <span className="text-[10px] font-medium tracking-wide text-[#d8c39c]">
                UI GLASS BLUR
              </span>
              <span className="text-[10px] tracking-wide text-[#8f8778]">
                Frosted backdrop blur on panels
              </span>
            </div>
            <ToggleSwitch
              checked={glassBlur}
              onChange={(val) => updateGraphics({ glassBlur: val })}
              label="Toggle UI glass blur"
            />
          </div>
        </div>

        {/* ── Section: EQUIPMENT & MOD ACCESSORIES ───────────────────── */}
      <div className={cardSurface}>
        <div className="flex items-center gap-2 border-b border-[#d4b483]/18 pb-1.5">
          <IconGear className="h-3.5 w-3.5 text-[#eac87f]" />
          <h3 className="text-[10px] font-medium tracking-[0.12em] text-[#efece6] uppercase">
            EQUIPMENT &amp; MOD RULES
          </h3>
        </div>

        {/* Setting 1: Unrestricted Slots / Ignore Naming */}
        <div className="flex flex-col gap-1.5 pt-1">
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-[10px] font-medium tracking-wide text-[#e8c98e]">
                IGNORE NAMING (UNRESTRICTED SLOTS)
              </span>
              <span className="text-[10px] tracking-wide text-[#a99e8c]/80">
                Equip any clothing or accessory in any slot
              </span>
            </div>
            <ToggleSwitch
              checked={unrestrictedSlots}
              onChange={setUnrestrictedSlots}
              label="Ignore naming and unrestrict equipment slots"
            />
          </div>
          <p className="rounded-xs border border-[#d4b483]/15 bg-black/35 p-2 text-[10px] leading-[1.4] text-[#b8ad99]">
            When enabled, all items become available in every slot. If a mod ships multiple accessories
            (e.g., Crown, Cape, Pauldrons, Halo, Necklace), you can equip them simultaneously across any
            available paper-doll slot.
          </p>
        </div>

        {/* Setting 2: Show Ground Meshes */}
        <div className="mt-2 flex items-center justify-between border-t border-[#d4b483]/14 pt-2">
          <div className="flex flex-col">
            <span className="text-[10px] font-medium tracking-wide text-[#d8c39c]">
              SHOW GROUND CLUTTER (_GND)
            </span>
            <span className="text-[10px] tracking-wide text-[#8f8778]">
              Include static world/dropped item meshes
            </span>
          </div>
          <ToggleSwitch
            checked={showGroundMeshes}
            onChange={setShowGroundMeshes}
            label="Show ground meshes"
          />
        </div>
      </div>

      {/* ── Section: VIEWPORT & INTERFACE ──────────────────────────── */}
      <div className={cardSurface}>
        <div className="flex items-center gap-2 border-b border-[#d4b483]/18 pb-1.5">
          <IconSparkle className="h-3.5 w-3.5 text-[#eac87f]" />
          <h3 className="text-[10px] font-medium tracking-[0.12em] text-[#efece6] uppercase">
            VIEWPORT &amp; INTERFACE
          </h3>
        </div>

        {/* Metric Mesh Topology Wireframe */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex flex-col">
            <span className="text-[10px] font-medium tracking-wide text-[#d8c39c]">
              METRIC MESH OVERLAY
            </span>
            <span className="text-[10px] tracking-wide text-[#8f8778]">
              3D facial topology wireframe &amp; landmarks
            </span>
          </div>
          <ToggleSwitch
            checked={showMesh}
            onChange={setShowMesh}
            label="Toggle metric mesh topology"
          />
        </div>

        {/* Cinematic Preview Mode */}
        <div className="mt-2 flex items-center justify-between border-t border-[#d4b483]/14 pt-2">
          <div className="flex flex-col">
            <span className="text-[10px] font-medium tracking-wide text-[#d8c39c]">
              CINEMATIC PREVIEW MODE
            </span>
            <span className="text-[10px] tracking-wide text-[#8f8778]">
              Hide HUD chrome (Shortcut: Esc)
            </span>
          </div>
          <ToggleSwitch
            checked={previewMode}
            onChange={setPreviewMode}
            label="Toggle cinematic preview mode"
          />
        </div>
      </div>

      {/* ── Section: ASSET PIPELINE INFO ───────────────────────────── */}
      <div className="flex flex-col gap-1.5 rounded-xs border border-[#d4b483]/15 bg-black/35 p-2.5 text-[10px] text-[#8f8778]">
        <div className="flex items-center justify-between text-[#c4b595]">
          <span>PIPELINE</span>
          <span className="text-[#eac87f]">PRESET PACK MODE</span>
        </div>
        <div className="flex items-center justify-between">
          <span>BODY COMPATIBILITY</span>
          <span className="text-[#cdc2ac]">UBE 2.0 · RACEMENU</span>
        </div>
        <div className="flex items-center justify-between">
          <span>RIGGING &amp; SKELETON</span>
          <span className="text-[#cdc2ac]">XPMSSE 4.82+</span>
        </div>
      </div>
      </div>
    </StudioCard>
  );
}
