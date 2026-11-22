// Photos are preview-only; fitting accepts isolated OBJ heads.
export const SMART_ACCEPT = '.obj,.png,.jpg,.jpeg,.webp';

export function isImageFile(name: string): boolean {
  return /\.(png|jpe?g|webp)$/i.test(name);
}

export function isObjFile(name: string): boolean {
  return /\.obj$/i.test(name);
}

export function isMeshFile(name: string): boolean {
  return /\.(obj|glb|gltf)$/i.test(name);
}

export function isUnsupportedMeshFile(name: string): boolean {
  return /\.(glb|gltf)$/i.test(name);
}
