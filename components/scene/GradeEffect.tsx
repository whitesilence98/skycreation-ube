'use client';

import { useEffect, useMemo } from 'react';
import { Effect } from 'postprocessing';
import { Uniform, Vector3 } from 'three';
import type { GradeSettings } from '@/lib/store';

/**
 * Linear-light colour grade: contrast, saturation, a filter preset, and three
 * luminance-band tints.
 *
 * Deliberately hand-written rather than `BrightnessContrastEffect` +
 * `HueSaturationEffect`: those declare `inputColorSpace = SRGBColorSpace`, so
 * postprocessing brackets them with an encode/decode pair. The composer is
 * linear until its trailing `ToneMapping`, so mounting them here would shift
 * the whole image even at neutral settings. This shader operates on the same
 * linear values the Enb pass does, which also makes "all zeroes = no change"
 * exactly true — the reason the component is only mounted when non-neutral.
 */

const fragmentShader = /* glsl */ `
uniform float uContrast;
uniform float uSaturation;
uniform float uFilter;
uniform vec3  uTint0;
uniform vec3  uTint1;
uniform vec3  uTint2;
uniform float uTintAmount0;
uniform float uTintAmount1;
uniform float uTintAmount2;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 c = inputColor.rgb;

    // ── 1. Contrast, pivoted at 0.5 ───────────────────────────────
    // The range is modest on purpose: a linear-light curve diverges from a
    // display-space one at the extremes, so ±100 maps to only ±0.6.
    float k = 1.0 + uContrast * 0.006;
    c = (c - 0.5) * k + 0.5;

    // ── 2. Saturation ─────────────────────────────────────────────
    float luma = dot(c, LUMA);
    c = mix(vec3(luma), c, 1.0 + uSaturation * 0.01);

    // ── 3. Filter presets ─────────────────────────────────────────
    // 0 vanilla, 1 dramatic, 2 cinematic, 3 fantasy.
    const float F_VANILLA   = 0.0;
    const float F_DRAMATIC  = 1.0;
    const float F_CINEMATIC = 2.0;
    const float F_FANTASY   = 3.0;

    if (abs(uFilter - F_DRAMATIC) < 0.5) {
        float l2 = dot(c, LUMA);
        c = (c - 0.5) * 1.22 + 0.5;                 // stronger S
        c += (0.5 - l2) * 0.04;                     // lifted shadows
        c = mix(vec3(l2), c, 1.06);
    } else if (abs(uFilter - F_CINEMATIC) < 0.5) {
        float l2 = dot(c, LUMA);
        float sW = smoothstep(0.42, 0.05, l2);
        float hW = smoothstep(0.45, 0.88, l2);
        c += sW * vec3(-0.012, 0.006, 0.022);      // teal shadows
        c += hW * vec3( 0.024, 0.010, -0.012);     // warm highlights
        c = (c - 0.5) * 1.08 + 0.5;
    } else if (abs(uFilter - F_FANTASY) < 0.5) {
        float l2 = dot(c, LUMA);
        c = mix(vec3(l2), c, 1.16);                // boosted chroma
        float mW = 1.0 - smoothstep(0.0, 0.34, abs(l2 - 0.5));
        c += mW * vec3(0.020, -0.006, 0.030);      // magenta mids
    }

    c = max(c, vec3(0.0));

    // ── 4. Luminance-band tints ───────────────────────────────────
    // Same split-tone idiom as the Enb pass, so the two agree.
    float L = dot(c, LUMA);
    float shadowW    = smoothstep(0.40, 0.02, L);
    float midW       = 1.0 - smoothstep(0.0, 0.38, abs(L - 0.45));
    float highlightW = smoothstep(0.45, 0.85, L);

    c += uTint0 * (uTintAmount0 * shadowW);
    c += uTint1 * (uTintAmount1 * midW);
    c += uTint2 * (uTintAmount2 * highlightW);

    outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
}
`;

const FILTER_INDEX = { vanilla: 0, dramatic: 1, cinematic: 2, fantasy: 3 } as const;

export class GradeEffectImpl extends Effect {
  constructor() {
    super('GradeEffect', fragmentShader, {
      uniforms: new Map<string, Uniform>([
        ['uContrast', new Uniform(0)],
        ['uSaturation', new Uniform(0)],
        ['uFilter', new Uniform(0)],
        ['uTint0', new Uniform(new Vector3(0, 0, 0))],
        ['uTint1', new Uniform(new Vector3(0, 0, 0))],
        ['uTint2', new Uniform(new Vector3(0, 0, 0))],
        ['uTintAmount0', new Uniform(0)],
        ['uTintAmount1', new Uniform(0)],
        ['uTintAmount2', new Uniform(0)],
      ]),
    });
  }

  /** Writes the grade into the uniforms. Named `applyGrade` because `Effect`
   *  already defines `update(renderer, inputBuffer, deltaTime)` as its
   *  per-frame hook. */
  applyGrade(grade: GradeSettings): void {
    const u = this.uniforms;
    u.get('uContrast')!.value = grade.contrast;
    u.get('uSaturation')!.value = grade.saturation;
    u.get('uFilter')!.value = FILTER_INDEX[grade.filter];
    grade.overlays.forEach((overlay, i) => {
      const tint = u.get(`uTint${i}`) as Uniform<Vector3>;
      const amount = u.get(`uTintAmount${i}`)!;
      const hex = overlay.color.replace('#', '');
      const r = parseInt(hex.slice(0, 2), 16) / 255;
      const g = parseInt(hex.slice(2, 4), 16) / 255;
      const b = parseInt(hex.slice(4, 6), 16) / 255;
      /* Center the swatch on zero so a tint adds chroma rather than light:
         a mid-grey overlay must not brighten the band it touches. */
      tint.value.set(r - 0.5, g - 0.5, b - 0.5);
      amount.value = overlay.enabled ? overlay.amount * 0.002 : 0;
    });
  }
}

/**
 * Mounted only while the grade is non-neutral (see `isGradeNeutral`), so the
 * default frame carries no extra pass. Updates write uniforms in place — the
 * effect instance must persist across slider moves or the composer rebuilds
 * its passes on every tick.
 */
export function GradeEffect({ settings }: { settings: GradeSettings }) {
  /* One instance for the mount's lifetime: the composer rebuilds its passes
     whenever a child effect identity changes, so slider moves must only write
     uniforms, never re-create the effect. */
  const effect = useMemo(() => new GradeEffectImpl(), []);

  useEffect(() => {
    effect.applyGrade(settings);
  }, [effect, settings]);

  return <primitive object={effect} />;
}
