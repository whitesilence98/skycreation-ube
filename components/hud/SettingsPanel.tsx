'use client';

import { useCharacter } from '@/lib/store';
import { cn } from '@/lib/cn';
import { IconCheck, IconGear, IconSparkle } from '@/components/hud/Icons';

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

export function SettingsPanel() {
  const unrestrictedSlots = useCharacter((s) => s.unrestrictedSlots);
  const setUnrestrictedSlots = useCharacter((s) => s.setUnrestrictedSlots);
  const showGroundMeshes = useCharacter((s) => s.showGroundMeshes);
  const setShowGroundMeshes = useCharacter((s) => s.setShowGroundMeshes);

  const showMesh = useCharacter((s) => s.showMesh);
  const setShowMesh = useCharacter((s) => s.setShowMesh);
  const previewMode = useCharacter((s) => s.previewMode);
  const setPreviewMode = useCharacter((s) => s.setPreviewMode);

  return (
    <div className="pointer-events-auto flex w-full flex-col gap-4 select-none p-3.5 hud-fade font-mono">
      {/* ── Section: EQUIPMENT & MOD ACCESSORIES ───────────────────── */}
      <div className="flex flex-col gap-2 rounded-xs border border-[#d4b483]/22 bg-black/45 p-3 backdrop-blur-md">
        <div className="flex items-center gap-2 border-b border-[#d4b483]/18 pb-1.5">
          <IconGear className="h-3.5 w-3.5 text-[#eac87f]" />
          <h3 className="text-[10.5px] font-medium tracking-[0.12em] text-[#efece6] uppercase">
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
              <span className="text-[8.5px] tracking-wide text-[#a99e8c]/80">
                Equip any clothing or accessory in any slot
              </span>
            </div>
            <ToggleSwitch
              checked={unrestrictedSlots}
              onChange={setUnrestrictedSlots}
              label="Ignore naming and unrestrict equipment slots"
            />
          </div>
          <p className="rounded-xs border border-[#d4b483]/15 bg-black/35 p-2 text-[9px] leading-[1.4] text-[#b8ad99]">
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
            <span className="text-[8.5px] tracking-wide text-[#8f8778]">
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
      <div className="flex flex-col gap-2 rounded-xs border border-[#d4b483]/22 bg-black/45 p-3 backdrop-blur-md">
        <div className="flex items-center gap-2 border-b border-[#d4b483]/18 pb-1.5">
          <IconSparkle className="h-3.5 w-3.5 text-[#eac87f]" />
          <h3 className="text-[10.5px] font-medium tracking-[0.12em] text-[#efece6] uppercase">
            VIEWPORT &amp; INTERFACE
          </h3>
        </div>

        {/* Metric Mesh Topology Wireframe */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex flex-col">
            <span className="text-[10px] font-medium tracking-wide text-[#d8c39c]">
              METRIC MESH OVERLAY
            </span>
            <span className="text-[8.5px] tracking-wide text-[#8f8778]">
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
            <span className="text-[8.5px] tracking-wide text-[#8f8778]">
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
      <div className="flex flex-col gap-1.5 rounded-xs border border-[#d4b483]/15 bg-black/35 p-2.5 text-[9px] text-[#8f8778]">
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
  );
}
