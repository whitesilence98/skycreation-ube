'use client';

import { useEffect, useRef, useState } from 'react';
import { Effect } from 'postprocessing';
import { Uniform, Texture, TextureLoader } from 'three';
import { wrapEffect } from '@react-three/postprocessing';
import type { PostFxMode } from '@/lib/store';

const fragmentShader = `
uniform sampler2D paletteTex;
uniform float hasPalette;
uniform float enbMix;
uniform float reshadeMix;
uniform float sssWarmth;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec4 col = inputColor;

    // ── 1. Pure 1.0.2 ReShade DPX & Color Matrix Pass ──────────
    if (reshadeMix > 0.001) {
        vec3 c = col.rgb;
        
        // Pure 1.0.2 DPX Cineon contrast & colorfulness
        float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
        vec3 satCol = mix(vec3(luma), c, 1.0 + 0.35 * reshadeMix);
        
        // DPX S-curve & contrast expansion (Pure contrast = 0.15)
        vec3 dpx = (satCol - 0.5) * (1.0 + 0.15 * reshadeMix) + 0.5;
        
        // Pure 1.0.2 ColorMatrix (RGB cross-talk)
        mat3 cMat = mat3(
            0.962, 0.010, 0.019,
            0.000, 1.000, 0.096,
            0.000, 0.000, 1.000
        );
        vec3 matCol = cMat * dpx;
        
        // Pure 1.0.2 Split Toning (Shadows-Midtones-Highlights)
        // blendcolor_s = [0.0, 0.365, 1.0] (cool shadows)
        // blendcolor_m = [1.0, 0.60, 0.0]  (warm skin midtones)
        float sWeight = smoothstep(0.40, 0.02, luma);
        float mWeight = 1.0 - smoothstep(0.0, 0.38, abs(luma - 0.45));
        
        matCol += sWeight * vec3(-0.018, 0.008, 0.035) * reshadeMix;
        matCol += mWeight * vec3(0.032, 0.015, -0.012) * reshadeMix;
        
        col.rgb = mix(col.rgb, max(matCol, vec3(0.0)), reshadeMix);
    }

    // ── 2. ENB Subsurface Scattering (Skin Warmth Diffusion) ──
    if (sssWarmth > 0.001) {
        float lum = dot(col.rgb, vec3(0.299, 0.587, 0.114));
        float sssBand = smoothstep(0.12, 0.42, lum) * (1.0 - smoothstep(0.42, 0.85, lum));
        vec3 sssColor = vec3(1.0, 0.38, 0.18) * col.rgb;
        col.rgb += sssBand * sssColor * (0.28 * sssWarmth);
    }

    // ── 3. ENB Palette 2D Lookup (enbpalette.bmp) ─────────────
    if (enbMix > 0.001 && hasPalette > 0.5) {
        vec3 cur = clamp(col.rgb, 0.0, 1.0);
        float lum = dot(cur, vec3(0.299, 0.587, 0.114));
        // Boris Vorontsov ENB formula from enbeffect.fx:
        // uvpalette.y = brightness / (brightness + 1.0)
        float b = clamp(lum / (lum + 0.85), 0.02, 0.98);
        
        vec3 pal;
        pal.r = texture2D(paletteTex, vec2(cur.r, b)).r;
        pal.g = texture2D(paletteTex, vec2(cur.g, b)).g;
        pal.b = texture2D(paletteTex, vec2(cur.b, b)).b;
        
        col.rgb = mix(col.rgb, pal, enbMix);
    }

    outputColor = col;
}
`;

export class EnbReshadeEffectImpl extends Effect {
  constructor() {
    super('EnbReshadeEffect', fragmentShader, {
      uniforms: new Map<string, Uniform>([
        ['paletteTex', new Uniform(null)],
        ['hasPalette', new Uniform(0.0)],
        ['enbMix', new Uniform(1.0)],
        ['reshadeMix', new Uniform(1.0)],
        ['sssWarmth', new Uniform(1.0)],
      ]),
    });
  }

  updateUniforms(palette: Texture | null, enbMix: number, reshadeMix: number, sss: number) {
    const pTex = this.uniforms.get('paletteTex');
    if (pTex && palette) {
      pTex.value = palette;
    }
    const hP = this.uniforms.get('hasPalette');
    if (hP) {
      hP.value = palette ? 1.0 : 0.0;
    }
    const eM = this.uniforms.get('enbMix');
    if (eM) eM.value = enbMix;
    const rM = this.uniforms.get('reshadeMix');
    if (rM) rM.value = reshadeMix;
    const sM = this.uniforms.get('sssWarmth');
    if (sM) sM.value = sss;
  }
}

const WrappedEffect = wrapEffect(EnbReshadeEffectImpl);

export interface EnbReshadeEffectProps {
  mode: PostFxMode;
}

export function EnbReshadeEffect({ mode }: EnbReshadeEffectProps) {
  const [palette, setPalette] = useState<Texture | null>(null);
  const effectRef = useRef<EnbReshadeEffectImpl | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loader = new TextureLoader();
    loader.load(
      '/assets/enb/enbpalette.png',
      (tex) => {
        if (cancelled) return;
        setPalette(tex);
      },
      undefined,
      (err) => console.warn('[EnbReshadeEffect] enbpalette.png not found, continuing without palette LUT:', err),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const enbMix = mode === 'enb' || mode === 'all' ? 1.0 : 0.0;
  const reshadeMix = mode === 'pure' || mode === 'all' ? 1.0 : 0.0;
  const sssWarmth = mode === 'enb' || mode === 'all' ? 1.0 : 0.0;

  useEffect(() => {
    if (effectRef.current) {
      effectRef.current.updateUniforms(palette, enbMix, reshadeMix, sssWarmth);
    }
  }, [palette, enbMix, reshadeMix, sssWarmth]);

  return <WrappedEffect ref={effectRef} />;
}
