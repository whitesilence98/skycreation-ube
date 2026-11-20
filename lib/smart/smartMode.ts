/**
 * The hidden switch that reveals the OBJ test path.
 *
 * `?smart=mesh` on the URL, or `NEXT_PUBLIC_SMART_OBJ=1` at build time. Both
 * exist because the first is shareable without a deploy and the second is what
 * a preview build uses. Read lazily and guarded — the flag is consumed during
 * render, but this module is also evaluated during server rendering, where
 * `window` does not exist.
 */
export type SmartSource = 'image' | 'mesh';

export const SMART_QUERY_PARAM = 'smart';
export const SMART_QUERY_VALUE = 'mesh';

export function meshModeEnabled(search?: string): boolean {
  if (process.env.NEXT_PUBLIC_SMART_OBJ === '1') return true;
  if (search !== undefined) {
    return new URLSearchParams(search).get(SMART_QUERY_PARAM) === SMART_QUERY_VALUE;
  }
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get(SMART_QUERY_PARAM) === SMART_QUERY_VALUE;
}

/** Extensions the Image tile accepts. Meshes are accepted there too: a mesh is
 *  the thing this build can actually apply, so refusing one on the default
 *  surface would be an obstacle with no purpose. */
export const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.webp,.obj,.glb,.gltf';
/** The DEV tile is strict: testers are here for the mesh path. */
export const MESH_ACCEPT = '.obj,.glb,.gltf';

export const MESH_EXTENSIONS = ['.obj', '.glb', '.gltf'];

export function isMeshFile(name: string): boolean {
  const lower = name.toLowerCase();
  return MESH_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function isImageFile(name: string): boolean {
  return /\.(png|jpe?g|webp)$/i.test(name);
}
