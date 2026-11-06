'use client';

import { useCharacter } from '@/lib/store';
import { HAIR_LIMITS } from '@/lib/hair/settings';
import { cn } from '@/lib/cn';

const [MIN, MAX] = HAIR_LIMITS.lengthCm;
/** Minor ticks every 5 cm, labelled every 10 cm. */
const TICKS = Array.from({ length: 12 }, (_, i) => MIN + ((MAX - MIN) / 11) * i);

/**
 * Vertical hair-length ruler between the viewport and the controller rail.
 *
 * It edits the same store value as the LENGTH slider, so the two can never
 * disagree. The control is a real `input[type=range]` laid out vertically:
 * arrows, Page Up/Down, Home and End keep working and the browser draws the
 * focus ring. Ticks and labels are presentational and ignore the pointer, so
 * dragging the canvas behind them still orbits the camera.
 *
 * Authored archive hair replaces the procedural shell outright, so the ruler
 * is disabled alongside the rest of the procedural controls.
 */
export function LengthRuler() {
  const primaryTab = useCharacter((s) => s.primaryTab);
  const lengthCm = useCharacter((s) => s.hair.lengthCm);
  const setHair = useCharacter((s) => s.setHair);
  const authored = useCharacter((s) => Boolean(s.assetSelection.hairMesh));

  if (primaryTab !== 'HAIR') return null;

  const pct = ((lengthCm - MIN) / (MAX - MIN)) * 100;

  return (
    <div
      className="absolute right-[262px] top-[103px] z-20 w-[28px] select-none hud-fade"
      aria-label="Hair length ruler"
      role="group"
    >
      <div className="mb-[1px] flex flex-col items-end gap-[1px]">
        <span className="whitespace-nowrap text-[6px] tracking-[0.16em] text-[#8f8778]/72">LENGTH</span>
        <span className="num whitespace-nowrap text-[9px] tracking-[0.02em] text-[#eadcc0]">
          {lengthCm.toFixed(1)}
          <span className="ml-[1px] text-[6px] tracking-[0.1em] text-[#b6a88f]/80">CM</span>
        </span>
      </div>

      {/* The rail reads bottom-to-top: 0 cm at the base, 55 cm at the top. */}
      <div className="relative h-[286px] w-[28px]">
        <input
          type="range"
          min={MIN}
          max={MAX}
          step={0.5}
          value={lengthCm}
          disabled={authored}
          onChange={(e) => setHair({ lengthCm: Number(e.target.value) })}
          aria-label="Hair length in centimetres"
          aria-valuetext={`${lengthCm.toFixed(1)} centimetres`}
          title={authored ? 'Return to procedural hair to edit the length' : `Hair length — ${lengthCm.toFixed(1)} cm`}
          className={cn(
            'hud-range-v absolute inset-y-0 right-0 z-10 h-full w-[18px]',
            authored && 'cursor-not-allowed opacity-40',
          )}
          style={{ ['--pct' as string]: `${pct}%` }}
        />

        {/* Ticks grow out from the track's centre line. Major labels sit in
            the 12 px of the box left of the 16 px slider, so a thumb at any
            value can never cover them. */}
        <div className="pointer-events-none absolute inset-y-0 right-0 w-[16px]" aria-hidden>
          {TICKS.map((v) => {
            const major = v % 10 === 0 || v === MAX;
            return (
              <div
                key={v}
                className="absolute right-0 flex w-full items-center"
                style={{ top: `${100 - ((v - MIN) / (MAX - MIN)) * 100}%` }}
              >
                <span
                  className={cn(
                    'absolute left-1/2 block h-px',
                    major ? 'w-[8px] bg-[#d4b483]/58' : 'w-[4px] bg-[#d4b483]/26',
                  )}
                />
                {major && (
                  <span className="num absolute right-full mr-[3px] -translate-y-1/2 whitespace-nowrap text-[5.5px] leading-none tracking-[0.02em] text-[#9a9181]/62">
                    {v}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-[5px] whitespace-nowrap text-right text-[5.5px] tracking-[0.1em] text-[#8b8375]/48">
        {authored ? 'AUTHORED' : `${MIN}–${MAX} CM`}
      </div>
    </div>
  );
}
