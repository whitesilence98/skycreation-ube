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
 *
 * What this patch deliberately does **not** do:
 *
 *  - It does not add its own specular lobe. ENB's skin specular replaces the
 *    renderer's; stacking a Blinn-Phong highlight on top of three's GGX
 *    double-counts every light and is a large part of why the face read as
 *    plastic. Gloss now reaches the GPU as a roughness map baked from the
 *    `_n.dds` alpha (see `scripts/sync_mo2_assets.gloss_mask_from_normal`) plus
 *    the GLOSS slider's scalar, and the physical lobe alone renders it.
 *  - It does not tint the scatter with a fixed orange. Real subsurface
 *    scatter is filtered by the albedo, so the added light is multiplied by
 *    `material.diffuseColor`; `uSSSColor` is only a warm bias on top.
 *  - Its wrap term can never add energy where the surface already faces the
 *    light: `fill = wrapped - saturate(NdotL)` is exactly zero at NdotL = 1,
 *    largest at the terminator, and zero again past NdotL = -wrap. The old
 *    term was an inverted Gaussian, brightest on the side *away* from the
 *    light, added on top of full Lambert — which is why the face glowed
 *    evenly and had no dark side.
 *  - It respects shadow maps. The old loop read `directionalLights[i].color`,
 *    the unshadowed uniform, so enabling shadows would have left the added
 *    skin light shining through them.
 */

import * as THREE from 'three';

export interface SkinShaderParams {
  /** SSS overall amount – ENB Amount=0.4 */
  sssAmount: number;
  /** Backlit translucency – ENB SubdermalTranslucency=0.85 */
  translucency: number;
  /** SSS scatter tint – a warm bias over the albedo, not a flat colour */
  sssColor: THREE.Color;
}

export const DEFAULT_SKIN_PARAMS: SkinShaderParams = {
  sssAmount: 0.40,
  translucency: 0.85,
  sssColor: new THREE.Color(0.96, 0.52, 0.38),
};

/** How far light wraps past the terminator, in NdotL units. 0.5 is a
 *  plausible thin-skin value: light reaches ~30° past the geometric horizon
 *  before the scatter dies out. */
const SKIN_WRAP = '0.5';

// ---------------------------------------------------------------------------
// GLSL — injected AFTER #include <lights_fragment_end>
// At this point: geometryNormal, geometryViewDir, reflectedLight and
// `material` (PhysicalMaterial, with diffuseColor) are all live.
// directionalLights[], receiveShadow and the directional shadow uniforms are
// available exactly as they are to the renderer's own loop.
// ---------------------------------------------------------------------------
const SKIN_CHUNK = /* glsl */`
// ── ENB subsurface scattering (wrap fill + backlit translucency) ──────────

#if NUM_DIR_LIGHTS > 0
{
  vec3 sss_accum = vec3(0.0);

  #pragma unroll_loop_start
  for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
  {
    // The extra brace is load-bearing: unroll_loop_start splices this body
    // out N times at the *same* scope (it strips the for-loop and its braces),
    // so without a nested block the second copy redeclares L / Lcolor / shadow
    // and the fragment shader fails to compile.
    vec3  L      = directionalLights[ i ].direction;
    vec3  Lcolor = directionalLights[ i ].color;
    float shadow = 1.0;

    // Same sampler the renderer's own loop uses, so enabling shadow maps
    // darkens the added skin light too. The receiveShadow uniform is what
    // shadowmask_pars_fragment tests; the loop variable directLight cannot be
    // trusted here because it holds the renderer's last iteration.
    #if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
      shadow = receiveShadow
        ? getShadow(
            directionalShadowMap[ i ],
            directionalLightShadows[ i ].shadowMapSize,
            directionalLightShadows[ i ].shadowIntensity,
            directionalLightShadows[ i ].shadowBias,
            directionalLightShadows[ i ].shadowRadius,
            vDirectionalShadowCoord[ i ] )
        : 1.0;
    #endif

    float NdotL = dot( geometryNormal, L );
    // Wrapped diffuse, brightest facing the light. Its excess over plain
    // Lambert is the missing terminator fill and nothing else: zero at
    // NdotL = 1, largest at the terminator, zero past NdotL = -WRAP.
    float wrapped = saturate( ( NdotL + ${SKIN_WRAP} ) / ( 1.0 + ${SKIN_WRAP} ) );
    float fill    = wrapped - saturate( NdotL );

    sss_accum += fill * Lcolor * shadow;

    // Thin-skin backlight (ears, nose rim): only where the surface turns
    // away, and shaped by a fourth power so it stays a rim.
    float back = saturate( dot( -geometryNormal, L ) );
    sss_accum += pow( back, 4.0 ) * Lcolor * shadow * uSkinTranslucency * 0.12;

  }
  }
  #pragma unroll_loop_end

  reflectedLight.directDiffuse +=
    sss_accum * material.diffuseColor * uSSSColor * uSSSAmount;
}
#endif
// ───────────────────────────────────────────────────────────────────────────
`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** The private fields `applySkinShader` hangs off a patched material. */
interface SkinMaterial extends THREE.MeshStandardMaterial {
  __skinUniforms?: Record<string, { value: unknown }> | null;
  /** The values a (re)compile seeds its uniforms from. Mutable on purpose. */
  __skinParams?: SkinShaderParams;
}

export function applySkinShader(
  mat: THREE.MeshStandardMaterial,
  params: SkinShaderParams = DEFAULT_SKIN_PARAMS,
): void {
  const skin = mat as SkinMaterial;
  /* Live, not captured. Three re-runs `onBeforeCompile` whenever the program
     cache key changes — attaching a `map` does exactly that — so a captured
     `params` would silently restore the values the material was born with the
     first time a texture finished loading, undoing every GLOSS or SSS change
     pushed since. `updateSkinUniforms` keeps this object current. */
  skin.__skinParams = { ...params, sssColor: params.sssColor.clone() };
  skin.__skinUniforms = null;
  mat.customProgramCacheKey = () => 'enb_skin_shader';

  mat.onBeforeCompile = (shader) => {
    const live = skin.__skinParams ?? params;
    shader.uniforms.uSSSAmount       = { value: live.sssAmount };
    shader.uniforms.uSkinTranslucency = { value: live.translucency };
    shader.uniforms.uSSSColor        = { value: live.sssColor.clone() };

    skin.__skinUniforms = shader.uniforms;

    // Declare uniforms at the top of the fragment shader
    const decls = `
uniform float uSSSAmount;
uniform float uSkinTranslucency;
uniform vec3  uSSSColor;
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
  const skin = mat as SkinMaterial;
  /* Record first, so a recompile that has not happened yet still picks up the
     new values, then push into whatever uniforms are live right now. */
  const live = skin.__skinParams;
  if (live) {
    if (params.sssAmount    !== undefined) live.sssAmount    = params.sssAmount;
    if (params.translucency !== undefined) live.translucency = params.translucency;
    if (params.sssColor     !== undefined) live.sssColor.copy(params.sssColor);
  }
  const u = skin.__skinUniforms;
  if (!u) return;
  if (params.sssAmount    !== undefined) u.uSSSAmount.value      = params.sssAmount;
  if (params.translucency !== undefined) u.uSkinTranslucency.value = params.translucency;
  if (params.sssColor     !== undefined) (u.uSSSColor.value as THREE.Color).copy(params.sssColor);
}

/** Map the GLOSS slider [0,1] → MeshStandardMaterial roughness.
 *
 *  This is now the *whole* scalar gloss path: the patch no longer adds its own
 *  highlight, so the physical lobe is the only specular. A roughness map
 *  baked from the `_n.dds` alpha multiplies this value per texel.
 *
 *  Head, neck and body all read this one function so a slider move cannot make
 *  one of them glossier than the others. */
export function skinRoughnessFromGloss(skinGloss: number): number {
  return Math.max(0.14, 0.65 - skinGloss * 0.46);
}

/** Map the GLOSS slider [0,1] → SkinShaderParams.
 *
 *  `sssStrength` is the panel's SUB-SURFACE SCATTERING control, applied on top
 *  of the gloss-derived amounts. Its default of 1 reproduces the gloss-only
 *  mapping exactly, so the first frame is unchanged. */
export function skinParamsFromGloss(skinGloss: number, sssStrength = 1): SkinShaderParams {
  const sss = Math.min(1, Math.max(0, sssStrength));
  return {
    sssAmount:   (0.18 + skinGloss * 0.28) * sss,
    translucency: (0.40 + skinGloss * 0.45) * sss,
    sssColor:    new THREE.Color(0.96, 0.52, 0.38),
  };
}

/** Every skin parameter a skin material needs: the shader uniforms plus the
 *  roughness of the material's own GGX lobe. One call, so a slot cannot pick
 *  up one half of the pair and not the other.
 *
 *  Call this **once**, when the material is created. For a live GLOSS/SSS
 *  change use `updateSkinGloss` — this one resets `__skinUniforms`, and since
 *  it leaves the program cache key alone three will not recompile to refill
 *  it, so a second call would leave the material pushing into nothing. */
export function applySkinGloss(
  mat: THREE.MeshStandardMaterial,
  skinGloss: number,
  sssStrength = 1,
): void {
  const params = skinParamsFromGloss(skinGloss, sssStrength);
  applySkinShader(mat, params);
  mat.roughness = skinRoughnessFromGloss(skinGloss);
}

/** The live-update half of `applySkinGloss`: uniforms in place (no recompile)
 *  and the material's own roughness. */
export function updateSkinGloss(
  mat: THREE.MeshStandardMaterial,
  skinGloss: number,
  sssStrength = 1,
): void {
  updateSkinUniforms(mat, skinParamsFromGloss(skinGloss, sssStrength));
  mat.roughness = skinRoughnessFromGloss(skinGloss);
}
