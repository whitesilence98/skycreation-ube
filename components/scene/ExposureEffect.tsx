'use client';

import { useEffect, useMemo } from 'react';
import { Effect } from 'postprocessing';
import { Uniform } from 'three';

/** Linear exposure before the existing single tone-mapping pass, not renderer exposure. */
export function ExposureEffect({ exposure }: { exposure: number }) {
  const effect = useMemo(() => new Effect('HdrExposure', `
    uniform float exposure;
    void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
      outputColor = vec4(inputColor.rgb * exposure, inputColor.a);
    }
  `, { uniforms: new Map([['exposure', new Uniform(1)]]) }), []);
  useEffect(() => { effect.uniforms.get('exposure')!.value = exposure; }, [effect, exposure]);
  return <primitive object={effect} />;
}
