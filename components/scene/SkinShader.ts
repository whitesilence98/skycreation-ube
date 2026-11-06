/**
 * ENB-calibrated skin shader patches for Three.js MeshStandardMaterial.
 *
 * Derived from D:\Games\Skyrim\Skyrim Special Edition\enbseries.ini:
 *
 *  [SUBSURFACESCATTERING]
 *    Amount              = 0.4
 *    EpidermalAmount     = 4.0
 *    SubdermalTranslucency = 0.85
 *    SurfaceBrightness   = 0.65
 *
 *  [WETSURFACES]  (interior day reference)
 *    GlossinessInteriorDay = 0.6
 *    FresnelMin          = 0.12
 *    FresnelCurve        = 7.0
 *
 *  [SKINSPECULAR]
 *    SpecularAmountInteriorDay = 0.2
 *
 * Strategy: use onBeforeCompile to inject AFTER lights_fragment_end
 * (where reflectedLight is fully accumulated) so we never clash with
 * Three.js's own lighting loops.
 */

import * as THREE from 'three';

export interface SkinShaderParams {
  /** SSS overall amount – ENB Amount=0.4 */
  sssAmount: number;
  /** Backlit translucency – ENB SubdermalTranslucency=0.85 */
  translucency: number;
  /** SSS scatter colour – warm peach flesh */
  sssColor: THREE.Color;
  /** Specular glossiness – ENB GlossinessInteriorDay=0.6 */
  glossiness: number;
  /** Fresnel minimum – ENB FresnelMin=0.12 */
  fresnelMin: number;
}

export const DEFAULT_SKIN_PARAMS: SkinShaderParams = {
  sssAmount: 0.40,
  translucency: 0.85,
  sssColor: new THREE.Color(0.95, 0.42, 0.28),
  glossiness: 0.60,
  fresnelMin: 0.12,
};

// ---------------------------------------------------------------------------
// GLSL — injected AFTER #include <lights_fragment_end>
// At this point: geometryNormal, geometryViewDir, reflectedLight are all live.
// directionalLights[] array and NUM_DIR_LIGHTS are available.
// ---------------------------------------------------------------------------
const SKIN_CHUNK = /* glsl */`
// ── ENB Subsurface Scattering + Dual-Lobe Specular ─────────────────────────

#if NUM_DIR_LIGHTS > 0
{
  vec3  sss_accum  = vec3(0.0);
  vec3  spec_accum = vec3(0.0);
  float NdotV      = saturate(dot(geometryNormal, geometryViewDir));
  float fresnel    = uSkinFresnelMin
                   + (1.0 - uSkinFresnelMin) * pow(1.0 - NdotV, 4.0);

  for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
    vec3  L       = directionalLights[i].direction;
    vec3  Lcolor  = directionalLights[i].color;
    float NdotL   = dot(geometryNormal, L);

    // --- SSS: wrapped diffuse (NdotL remapped to [0,1] so back-side glows) --
    float wrapped  = NdotL * 0.5 + 0.5;              // 0 .. 1
    float epi_lobe = exp(-wrapped * wrapped / 0.09);  // narrow epidermal
    float sub_lobe = exp(-wrapped * wrapped / 0.42);  // broad subdermal
    float sss_term = mix(sub_lobe, epi_lobe, 0.72);   // EpidermalAmount / total

    sss_accum += sss_term * Lcolor;

    // --- Backlit translucency (thin parts: ears, nose) ----------------------
    float back_NdotL = saturate(dot(-geometryNormal, L));
    sss_accum += back_NdotL * back_NdotL * Lcolor * uSkinTranslucency * 0.3;

    // --- Dual-lobe Blinn-Phong specular -------------------------------------
    float frontNdotL = saturate(NdotL);
    if (frontNdotL > 0.0) {
      vec3  H      = normalize(L + geometryViewDir);
      float NdotH  = saturate(dot(geometryNormal, H));
      // wide lobe (oily skin base): shininess ~16
      float spec_w = pow(NdotH, 16.0) * frontNdotL;
      // narrow lobe (pore highlight): shininess ~128
      float spec_n = pow(NdotH, 128.0) * frontNdotL;
      spec_accum  += (spec_w * 0.65 + spec_n * 0.35) * Lcolor;
    }
  }

  reflectedLight.directDiffuse  += sss_accum  * uSSSColor * uSSSAmount;
  reflectedLight.directSpecular += spec_accum * fresnel * uSkinGlossiness * 0.5;
}
#endif
// ───────────────────────────────────────────────────────────────────────────
`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function applySkinShader(
  mat: THREE.MeshStandardMaterial,
  params: SkinShaderParams = DEFAULT_SKIN_PARAMS,
): void {
  (mat as any).__skinUniforms = null;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSSSAmount       = { value: params.sssAmount };
    shader.uniforms.uSkinTranslucency = { value: params.translucency };
    shader.uniforms.uSSSColor        = { value: params.sssColor.clone() };
    shader.uniforms.uSkinGlossiness  = { value: params.glossiness };
    shader.uniforms.uSkinFresnelMin  = { value: params.fresnelMin };

    (mat as any).__skinUniforms = shader.uniforms;

    // Declare uniforms at the top of the fragment shader
    const decls = `
uniform float uSSSAmount;
uniform float uSkinTranslucency;
uniform vec3  uSSSColor;
uniform float uSkinGlossiness;
uniform float uSkinFresnelMin;
`;
    shader.fragmentShader = decls + shader.fragmentShader;

    // Inject our skin chunk AFTER lights_fragment_end
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_end>',
      '#include <lights_fragment_end>\n' + SKIN_CHUNK,
    );
  };

  mat.needsUpdate = true;
}

export function updateSkinUniforms(
  mat: THREE.MeshStandardMaterial,
  params: Partial<SkinShaderParams>,
): void {
  const u = (mat as any).__skinUniforms;
  if (!u) return;
  if (params.sssAmount    !== undefined) u.uSSSAmount.value      = params.sssAmount;
  if (params.translucency !== undefined) u.uSkinTranslucency.value = params.translucency;
  if (params.sssColor     !== undefined) u.uSSSColor.value.copy(params.sssColor);
  if (params.glossiness   !== undefined) u.uSkinGlossiness.value  = params.glossiness;
  if (params.fresnelMin   !== undefined) u.uSkinFresnelMin.value  = params.fresnelMin;
}

/** Map the GLOSS slider [0,1] → SkinShaderParams. */
export function skinParamsFromGloss(skinGloss: number): SkinShaderParams {
  return {
    sssAmount:   0.18 + skinGloss * 0.28,
    translucency: 0.40 + skinGloss * 0.45,
    sssColor:    new THREE.Color(0.95, 0.42, 0.28),
    glossiness:  0.08 + skinGloss * 0.60,
    fresnelMin:  0.12,
  };
}
