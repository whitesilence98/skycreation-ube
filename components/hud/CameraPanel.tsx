'use client';

import { useCharacter } from '@/lib/store';
import {
  CAMERA_FOV_DEFAULT,
  CAMERA_FOV_MIN,
  CAMERA_FOV_MAX,
  PITCH_PRESETS,
  CAMERA_ROTATE_SPEED_MIN,
  CAMERA_ROTATE_SPEED_MAX,
  YAW_PRESETS,
  verticalFovToSkyrimHov,
  type CameraFraming,
} from '@/lib/camera';
import { ENV_MODES, type EnvMode } from '@/lib/envModes';
import { BACKGROUND_PRESETS, type BackgroundMode } from '@/lib/backgrounds';
import { LIGHTING_DEFAULTS, LIGHT_RIGS } from '@/lib/lighting';
import { useViewState } from '@/lib/viewState';
import { StudioCard } from '@/components/hud/common/StudioCard';
import { cn } from '@/lib/cn';
import { IconRevert } from '@/components/hud/Icons';
import { RangeRow } from '@/components/hud/HudSlider';

/** Local labels only: importing `ENV_CONFIG` would pull Three into the HUD bundle. */
const ENV_LABELS: Record<EnvMode, string> = {
  off: 'Baseline',
  studio: 'Studio',
  sunset: 'Sunset',
  forest: 'Forest',
  tavern: 'Hearth',
  dawn: 'Dawn',
};

const signedDeg = (n: number) => `${n > 0 ? '+' : ''}${n}°`;

function SectionTitle({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-[4px] flex items-baseline justify-between">
      <h3 className="text-[10px] font-normal tracking-[0.13em] text-[#e6dcc8]/92">{children}</h3>
      {sub && <span className="text-[10px] tracking-[0.12em] text-[#a49a88]/62">{sub}</span>}
    </div>
  );
}

/**
 * Live camera telemetry. Subscribes on its own so the panel body can stay
 * unsubscribed, and it is only mounted while the panel is open — a closed
 * panel therefore holds no camera subscription.
 */
function ViewReadout() {
  const yawDeg = useViewState((s) => s.yawDeg);
  const pitchDeg = useViewState((s) => s.pitchDeg);
  const distance = useViewState((s) => s.distance);
  return (
    <p
      className="num flex items-center justify-between text-[10px] tracking-[0.08em] text-[#a49a88]/78"
      aria-label="Live camera angle and distance"
    >
      <span>
        YAW <span className="text-[#d8c9ad]/88">{signedDeg(Math.round(yawDeg))}</span>
      </span>
      <span>
        PITCH <span className="text-[#d8c9ad]/88">{signedDeg(Math.round(pitchDeg))}</span>
      </span>
      <span>
        DIST <span className="text-[#d8c9ad]/88">{distance > 0 ? `${distance.toFixed(2)} m` : '—'}</span>
      </span>
    </p>
  );
}

export interface CameraPanelProps {
  onClose?: () => void;
}

export function CameraPanel({ onClose }: CameraPanelProps = {}) {

  const cameraFov = useCharacter((s) => s.cameraFov);
  const setCameraFov = useCharacter((s) => s.setCameraFov);
  const cameraFraming = useCharacter((s) => s.cameraFraming);
  const setCameraFraming = useCharacter((s) => s.setCameraFraming);
  const triggerCameraPose = useCharacter((s) => s.triggerCameraPose);
  const resetCameraView = useCharacter((s) => s.resetCameraView);
  const cameraRotateSpeed = useCharacter((s) => s.cameraRotateSpeed);
  const setCameraRotateSpeed = useCharacter((s) => s.setCameraRotateSpeed);

  const lighting = useCharacter((s) => s.lighting);
  const setLighting = useCharacter((s) => s.setLighting);
  const envMode = useCharacter((s) => s.envMode);
  const setEnvMode = useCharacter((s) => s.setEnvMode);
  const envRotation = useCharacter((s) => s.envRotation);
  const setEnvRotation = useCharacter((s) => s.setEnvRotation);
  const envIntensity = useCharacter((s) => s.envIntensity);
  const setEnvIntensity = useCharacter((s) => s.setEnvIntensity);
  const backgroundMode = useCharacter((s) => s.backgroundMode);
  const setBackgroundMode = useCharacter((s) => s.setBackgroundMode);
  const customBackgroundUrl = useCharacter((s) => s.customBackgroundUrl);
  const setCustomBackgroundUrl = useCharacter((s) => s.setCustomBackgroundUrl);
  const grade = useCharacter((s) => s.grade);
  const setGrade = useCharacter((s) => s.setGrade);


  const skyrimHov = verticalFovToSkyrimHov(cameraFov);
  const fovPct = ((cameraFov - CAMERA_FOV_MIN) / (CAMERA_FOV_MAX - CAMERA_FOV_MIN)) * 100;

  const FRAMING_OPTIONS: Array<{ id: CameraFraming; label: string; desc: string }> = [
    { id: 'auto', label: 'AUTO', desc: 'Tab-driven' },
    { id: 'face', label: 'FACE', desc: '0.75 m' },
    { id: 'bust', label: 'BUST', desc: '1.25 m' },
    { id: 'body', label: 'BODY', desc: '3.80 m' },
  ];

  const FOV_QUICK_PRESETS = [
    { fov: 17, label: '17° Tele', skyrim: 30 },
    { fov: 27, label: '27° Portrait', skyrim: 46 },
    { fov: 36, label: '36° Bust', skyrim: 60 },
    { fov: 47, label: '47° World', skyrim: 75 },
  ];

  const isRigActive = (preset: (typeof LIGHT_RIGS)[number]['preset']) =>
    preset.intensity === lighting.intensity &&
    preset.fill === lighting.fill &&
    preset.rim === lighting.rim &&
    preset.azimuth === lighting.azimuth &&
    preset.elevation === lighting.elevation &&
    preset.keyColor === lighting.keyColor;

  return (
    <StudioCard
      title="CAMERA & FRAMING"
      badge="CINEMATIC"
      onClose={onClose ?? (() => useCharacter.getState().setWorkspace('edit'))}
      headerTrailing={
        <button
          type="button"
          onClick={resetCameraView}
          title="Reset to default front face view"
          className="flex items-center gap-[3px] text-[9.5px] font-mono tracking-[0.08em] text-[#a49a88]/75 transition-colors hover:text-[#f0e3c6]"
        >
          <IconRevert className="h-[7px] w-[7px]" />
          <span>RESET</span>
        </button>
      }
      footerLeading={<span>+ 4K CINEMATIC PIVOT</span>}
      footerTrailing={<span>FOV {Math.round(cameraFov)}°</span>}
      showSparkle
    >
      <div className="flex flex-col gap-[7px]">
        {/* ── framing presets ── */}
        <div>
          <SectionTitle sub="DISTANCE &amp; TARGET">FRAMING</SectionTitle>
          <div className="grid grid-cols-4 gap-[4px]">
            {FRAMING_OPTIONS.map((opt) => {
              const active = cameraFraming === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setCameraFraming(opt.id)}
                  aria-pressed={active}
                  title={`${opt.label} framing (${opt.desc})`}
                  className={cn(
                    'flex h-[20px] flex-col items-center justify-center border transition-all duration-150 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#eac87f]/80',
                    active
                      ? 'border-[#d8be8c] bg-[#d4b483]/16 text-[#f2e5cb] shadow-[0_0_8px_rgba(216,190,140,0.2)]'
                      : 'border-[#8c8477]/28 bg-black/30 text-[#a9a192]/76 hover:border-[#d4b483]/45 hover:text-[#ded5c3]',
                  )}
                >
                  <span className="text-[10px] font-medium tracking-[0.1em]">{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="hud-divider" />

        {/* ── live orbit telemetry + drag speed ── */}
        <div className="flex flex-col gap-[4px]">
          <ViewReadout />
          <RangeRow
            label="DRAG SPEED"
            value={cameraRotateSpeed}
            min={CAMERA_ROTATE_SPEED_MIN}
            max={CAMERA_ROTATE_SPEED_MAX}
            step={0.01}
            onChange={setCameraRotateSpeed}
            ariaLabel="Camera drag rotate speed"
            format={(v) => v.toFixed(2)}
          />
          <p className="text-[10px] tracking-[0.08em] text-[#8f8778]/65">
            Drag LMB/RMB to orbit · Scroll to zoom
          </p>
        </div>

        <div className="hud-divider" />

        {/* ── yaw angle presets ── */}
        <div>
          <SectionTitle sub="HORIZONTAL YAW">VIEW ANGLE</SectionTitle>
          <div className="grid grid-cols-3 gap-[4px]">
            {YAW_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => triggerCameraPose({ yaw: preset.yaw })}
                title={`Rotate camera to ${preset.label}`}
                className="flex h-[18px] items-center justify-center border border-[#8c8477]/30 bg-black/32 px-[3px] text-[10px] tracking-[0.08em] text-[#c7bea9]/85 transition-all duration-150 hover:border-[#d4b483]/55 hover:bg-[#d4b483]/[0.08] hover:text-[#f2e7cf] active:scale-[0.98] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#eac87f]/80"
              >
                <span>{preset.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="hud-divider" />

        {/* ── pitch angle presets ── */}
        <div>
          <SectionTitle sub="ELEVATION">PITCH</SectionTitle>
          <div className="grid grid-cols-3 gap-[4px]">
            {PITCH_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => triggerCameraPose({ pitch: preset.pitch })}
                title={`Set camera pitch to ${preset.label}`}
                className="flex h-[18px] items-center justify-center border border-[#8c8477]/30 bg-black/32 px-[3px] text-[10px] tracking-[0.08em] text-[#c7bea9]/85 transition-all duration-150 hover:border-[#d4b483]/55 hover:bg-[#d4b483]/[0.08] hover:text-[#f2e7cf] active:scale-[0.98] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#eac87f]/80"
              >
                <span>{preset.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="hud-divider" />

        {/* ── field of view ── */}
        <div>
          <div className="mb-[4px] flex items-baseline justify-between">
            <span className="text-[10px] font-normal tracking-[0.13em] text-[#e6dcc8]/92">
              FIELD OF VIEW
            </span>
            <div className="flex items-center gap-[4px] text-[10px] tracking-[0.08em]">
              <span className="font-mono text-[#eac87f]">{cameraFov}°</span>
              <span className="text-[#8e8574]">
                [Skyrim: <span className="text-[#c9b184]">fov {skyrimHov}</span>]
              </span>
            </div>
          </div>

          <div className="flex items-center gap-[6px]">
            <input
              type="range"
              min={CAMERA_FOV_MIN}
              max={CAMERA_FOV_MAX}
              step={1}
              value={cameraFov}
              onChange={(e) => setCameraFov(Number(e.target.value))}
              aria-label="Camera field of view"
              className="hud-range h-[10px] flex-1 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[#eac87f]"
              style={{ ['--pct' as string]: `${fovPct}%` }}
            />
            {cameraFov !== CAMERA_FOV_DEFAULT && (
              <button
                type="button"
                onClick={() => setCameraFov(CAMERA_FOV_DEFAULT)}
                title="Reset FOV to 27°"
                className="text-[10px] tracking-[0.08em] text-[#a49a88]/70 hover:text-[#e8dcc2] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#eac87f]/80"
              >
                [27°]
              </button>
            )}
          </div>

          {/* quick fov chips */}
          <div className="mt-[5px] grid grid-cols-4 gap-[3px]">
            {FOV_QUICK_PRESETS.map((qp) => {
              const active = cameraFov === qp.fov;
              return (
                <button
                  key={qp.fov}
                  type="button"
                  onClick={() => setCameraFov(qp.fov)}
                  aria-pressed={active}
                  title={`Set FOV to ${qp.fov}° (Skyrim: fov ${qp.skyrim})`}
                  className={cn(
                    'flex h-[16px] items-center justify-center border text-[10px] tracking-[0.06em] transition-all focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#eac87f]/80',
                    active
                      ? 'border-[#d8be8c] bg-[#d4b483]/18 text-[#f2e7cf]'
                      : 'border-[#8c8477]/22 bg-black/25 text-[#9e9584]/75 hover:border-[#d4b483]/40 hover:text-[#d8cebc]',
                  )}
                >
                  <span>{qp.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="hud-divider" />

        {/* ── three-point studio lighting ── */}
        <div>
          <div className="mb-[4px] flex items-baseline justify-between">
            <h3 className="text-[10px] font-normal tracking-[0.13em] text-[#e6dcc8]/92">LIGHTING</h3>
            <button
              type="button"
              onClick={() => setLighting(LIGHTING_DEFAULTS)}
              title="Restore the default studio lighting rig"
              className="flex items-center gap-[3px] text-[10px] tracking-[0.1em] text-[#a49a88]/75 transition-colors hover:text-[#f0e3c6] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#eac87f]/80"
            >
              <IconRevert className="h-[7px] w-[7px]" />
              <span>RESET LIGHTS</span>
            </button>
          </div>

          <div className="grid grid-cols-5 gap-[3px]">
            {LIGHT_RIGS.map((rig) => {
              const active = isRigActive(rig.preset);
              return (
                <button
                  key={rig.id}
                  type="button"
                  onClick={() => setLighting(rig.preset)}
                  aria-pressed={active}
                  title={`Apply the ${rig.label.toLowerCase()} lighting rig`}
                  className={cn(
                    'flex h-[16px] items-center justify-center border text-[10px] tracking-[0.06em] transition-all focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#eac87f]/80',
                    active
                      ? 'border-[#d8be8c] bg-[#d4b483]/18 text-[#f2e7cf]'
                      : 'border-[#8c8477]/22 bg-black/25 text-[#9e9584]/75 hover:border-[#d4b483]/40 hover:text-[#d8cebc]',
                  )}
                >
                  <span>{rig.label}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-[4px] flex flex-col">
            <RangeRow
              label="AZIMUTH"
              value={lighting.azimuth}
              min={0}
              max={359}
              onChange={(azimuth) => setLighting({ azimuth })}
              ariaLabel="Key light azimuth"
              format={(v) => `${v}°`}
            />
            <RangeRow
              label="ELEVATION"
              value={lighting.elevation}
              min={-45}
              max={45}
              onChange={(elevation) => setLighting({ elevation })}
              ariaLabel="Key light elevation"
              format={signedDeg}
            />
            <RangeRow
              label="LIGHT LEVEL"
              value={lighting.intensity}
              min={0.2}
              max={2}
              step={0.01}
              onChange={(intensity) => setLighting({ intensity })}
              ariaLabel="Key light strength"
              format={(v) => v.toFixed(2)}
            />
            <RangeRow
              label="FILL"
              value={lighting.fill}
              min={0}
              max={2}
              step={0.01}
              onChange={(fill) => setLighting({ fill })}
              ariaLabel="Fill light strength"
              format={(v) => v.toFixed(2)}
            />
            <RangeRow
              label="RIM"
              value={lighting.rim}
              min={0}
              max={2}
              step={0.01}
              onChange={(rim) => setLighting({ rim })}
              ariaLabel="Rim light strength"
              format={(v) => v.toFixed(2)}
            />
            <RangeRow
              label="AMBIENT"
              value={grade.ambient}
              min={-10}
              max={10}
              onChange={(ambient) => setGrade({ ambient })}
              ariaLabel="Ambient light"
            />
            <div className="flex h-[13px] items-center gap-[6px]">
              <label
                htmlFor="key-light-color"
                className="w-[104px] shrink-0 whitespace-nowrap text-[10px] tracking-[0.1em] text-[#cfc6b4]/88"
              >
                KEY COLOR
              </label>
              <input
                id="key-light-color"
                type="color"
                value={lighting.keyColor}
                onChange={(e) => setLighting({ keyColor: e.target.value })}
                title="Key light colour"
                aria-label="Key light colour"
                className="h-[11px] w-[24px] cursor-pointer border border-[#8c8477]/40 bg-transparent p-0 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[#eac87f]"
              />
              <span className="flex-1 text-right text-[10px] tracking-[0.06em] text-[#a49a88]/70">
                {lighting.keyColor.toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        <div className="hud-divider" />

        {/* ── procedural environment ──────────────────────────────────
            `off` is labelled Baseline because it renders RoomEnvironment. */}
        <div>
          <SectionTitle sub="PROCEDURAL IBL">ENVIRONMENT</SectionTitle>
          <div className="grid grid-cols-3 gap-[3px]">
            {ENV_MODES.map((mode) => {
              const active = envMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setEnvMode(mode)}
                  aria-pressed={active}
                  title={`Environment: ${ENV_LABELS[mode].toLowerCase()}`}
                  className={cn(
                    'flex h-[16px] items-center justify-center border text-[10px] tracking-[0.06em] transition-all focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#eac87f]/80',
                    active
                      ? 'border-[#d8be8c] bg-[#d4b483]/18 text-[#f2e7cf]'
                      : 'border-[#8c8477]/22 bg-black/25 text-[#9e9584]/75 hover:border-[#d4b483]/40 hover:text-[#d8cebc]',
                  )}
                >
                  <span>{ENV_LABELS[mode]}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-[4px] flex flex-col">
            <RangeRow
              label="ROTATION"
              value={envRotation}
              min={0}
              max={359}
              onChange={setEnvRotation}
              ariaLabel="Environment rotation"
              format={(v) => `${v}°`}
            />
            <RangeRow
              label="INTENSITY"
              value={envIntensity}
              min={0}
              max={2}
              step={0.01}
              onChange={setEnvIntensity}
              ariaLabel="Environment intensity"
              format={(v) => v.toFixed(2)}
            />
          </div>
        </div>

        <div className="hud-divider" />

        {/* ── 3D background & stage ── */}
        <div>
          <SectionTitle sub="3D STAGE & SCENE">BACKGROUND</SectionTitle>
          <div className="grid grid-cols-3 gap-[3px]">
            {BACKGROUND_PRESETS.map((preset) => {
              const active = backgroundMode === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setBackgroundMode(preset.id)}
                  aria-pressed={active}
                  title={`${preset.label}: ${preset.description}`}
                  className={cn(
                    'flex h-[28px] flex-col items-center justify-center border text-center transition-all focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#eac87f]/80',
                    active
                      ? 'border-[#d8be8c] bg-[#d4b483]/18 text-[#f2e7cf] shadow-[0_0_8px_rgba(216,190,140,0.25)]'
                      : 'border-[#8c8477]/22 bg-black/25 text-[#9e9584]/75 hover:border-[#d4b483]/40 hover:text-[#d8cebc]',
                  )}
                >
                  <span className="text-[10px] leading-tight font-medium tracking-[0.04em]">{preset.label}</span>
                  <span className="text-[8px] leading-tight tracking-[0.06em] text-[#a49a88]/60">{preset.sub}</span>
                </button>
              );
            })}
          </div>

          {backgroundMode === 'custom-3d' && (
            <div className="mt-[6px] flex flex-col gap-[3px]">
              <div className="flex items-center gap-[4px]">
                <input
                  type="text"
                  placeholder="URL to .glb / .gltf model"
                  value={customBackgroundUrl ?? ''}
                  onChange={(e) => setCustomBackgroundUrl(e.target.value || null)}
                  className="h-[18px] flex-1 border border-[#8c8477]/35 bg-black/40 px-[5px] text-[10px] text-[#e6dcc8] placeholder-[#a49a88]/40 focus:border-[#d8be8c] focus:outline-none"
                />
                <label className="flex h-[18px] cursor-pointer items-center border border-[#8c8477]/35 bg-black/30 px-[6px] text-[9px] tracking-[0.05em] text-[#cfc6b4] hover:border-[#d8be8c] hover:text-white">
                  FILE
                  <input
                    type="file"
                    accept=".glb,.gltf"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const url = URL.createObjectURL(file);
                        setCustomBackgroundUrl(url);
                      }
                    }}
                  />
                </label>
              </div>
            </div>
          )}
        </div>
      </div>
    </StudioCard>
  );
}
