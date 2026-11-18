'use client';

import { useRef, useState } from 'react';
import { useCharacter, type ToneMappingId } from '@/lib/store';
import { useHdr } from '@/lib/hdrState';
import { hdrFormat, inspectHdrHeader } from '@/lib/hdr';
import { ENV_MODES, type EnvMode } from '@/lib/envModes';
import { StudioCard } from '@/components/hud/common/StudioCard';
import { HudSlider } from '@/components/hud/HudSlider';

const buttonClass = 'border border-[#d4b483]/35 px-2 py-1.5 text-[11px] text-[#e6d3ac] hover:bg-[#d4b483]/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#eac87f]';
const selectClass = 'w-full border border-[#d4b483]/35 bg-[#161311] p-2 text-[12px] text-[#eee0c8] focus-visible:outline focus-visible:outline-[#eac87f]';
const ENV_LABELS: Record<EnvMode, string> = { off: 'Baseline', studio: 'Studio', sunset: 'Sunset', forest: 'Forest', tavern: 'Hearth', dawn: 'Dawn' };

export function HdrPanel({ onClose }: { onClose: () => void }) {
  const source = useHdr(s => s.source);
  const status = useHdr(s => s.status);
  const error = useHdr(s => s.error);
  const intensity = useCharacter(s => s.envIntensity);
  const rotation = useCharacter(s => s.envRotation);
  const exposure = useCharacter(s => s.exposure);
  const toneMapping = useCharacter(s => s.toneMapping);
  const envMode = useCharacter(s => s.envMode);
  const [reading, setReading] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const request = useRef(0);
  const s = useCharacter.getState;
  const studio = () => {
    request.current++;
    setReading(false); setInputError(null);
    useHdr.getState().setSource(null);
  };
  return <StudioCard title="LIGHTING" badge="HDR / IBL" onClose={onClose}
    footerLeading={<span>Local HDRI · Three.js PBR</span>}>
    <div className="space-y-4 text-[12px] leading-relaxed text-[#d8c9b2]">
      <p>Import an equirectangular panorama for reflections and ambient lighting. Your current background and direct lights stay unchanged.</p>
      <label className="block space-y-2">
        <span className="block text-[#eee0c8]">Import HDRI (.hdr / .exr)</span>
        <input type="file" accept=".hdr,.exr" aria-label="Import HDR environment panorama"
          className="block w-full min-w-0 text-[11px] text-[#d8c9b2] file:mr-2 file:border file:border-[#d4b483]/35 file:bg-[#161311] file:p-2 file:text-[#e6d3ac] focus-visible:outline focus-visible:outline-[#eac87f]"
          onChange={async event => {
            const file = event.target.files?.[0]; event.target.value = '';
            if (!file) return;
            const id = ++request.current;
            setInputError(null); setReading(true);
            try {
              const format = hdrFormat(file.name, file.size);
              const buffer = await file.arrayBuffer();
              inspectHdrHeader(buffer, format);
              if (id !== request.current) return;
              useHdr.getState().setSource({ name: file.name, format, buffer });
            } catch (err) {
              if (id === request.current) setInputError(err instanceof Error ? err.message : 'Could not read this HDRI.');
            } finally {
              if (id === request.current) setReading(false);
            }
          }} />
      </label>
      <p className="text-[11px]">Up to 32 MiB, 4096 px per edge, 8 megapixels. Single-part scanline EXR only. Large files can briefly pause the viewport during local decoding.</p>
      <div role="status" aria-live="polite" className="break-words border border-[#d4b483]/25 p-2">
        {reading ? 'Reading file…' : status === 'loading' ? 'Preparing environment…' : status === 'ready' ? `Active: ${source?.name}` : status === 'error' ? 'HDRI failed; procedural lighting is active.' : 'Procedural studio lighting is active.'}
      </div>
      {(inputError || error) && <p role="alert" className="text-[#f2cfaa]">{inputError || error}</p>}
      <p className="text-[11px]">File stays in this tab only. Re-select it after reload; it is not uploaded, saved into presets, or copied into exported characters.</p>
      <label className="block space-y-1">
        <span>Procedural fallback</span>
        <select aria-label="Procedural HDR fallback" className={selectClass} value={envMode}
          onChange={e => { studio(); s().setEnvMode(e.target.value as EnvMode); }}>
          {ENV_MODES.map(mode => <option key={mode} value={mode}>{ENV_LABELS[mode]}</option>)}
        </select>
      </label>
      <HudSlider label="Environment intensity" min={0} max={2} step={0.01} value={intensity}
        display={intensity.toFixed(2)} onChange={v => s().setEnvIntensity(v)} />
      <HudSlider label="Environment rotation" min={0} max={359} step={1} value={rotation}
        display={`${Math.round(rotation)}°`} onChange={v => s().setEnvRotation(v)} />
      <HudSlider label="Exposure multiplier" min={0.1} max={4} step={0.01} value={exposure}
        display={exposure.toFixed(2)} onChange={v => s().setExposure(v)} />
      <label className="block space-y-1">
        <span>Tone mapping</span>
        <select aria-label="HDR tone mapping" className={selectClass} value={toneMapping}
          onChange={e => s().setToneMapping(e.target.value as ToneMappingId)}>
          <option value="neutral">PBR Neutral</option><option value="aces">ACES Filmic</option>
          <option value="agx">AgX</option><option value="cineon">Cineon</option>
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass} onClick={studio}>Remove imported HDRI</button>
        <button type="button" className={buttonClass} onClick={() => {
          studio(); s().setEnvMode('studio'); s().setEnvIntensity(1); s().setEnvRotation(0);
          s().setExposure(1); s().setToneMapping('neutral');
        }}>Reset HDR lighting</button>
      </div>
      <p className="text-[11px]">Roughness and normal maps still control highlight detail. This panel does not replace skin shaders, change clothing materials, or treat skin as transmissive glass.</p>
    </div>
  </StudioCard>;
}
