import * as THREE from 'three';

export interface FabricPbrProfile {
  roughness: number;
  metalness: number;
  sheen: number;
  sheenColor: string;
  sheenRoughness: number;
  clearcoat?: number;
}

/**
 * Classifies a garment or accessory by authored name to produce physically accurate
 * PBR parameters with micro-fiber fabric sheen, eliminating the shiny plastic look on clothing.
 */
export function detectFabricProfile(name: string = ''): FabricPbrProfile {
  const lower = name.toLowerCase();

  // Metal clasps, buckles, rings, armor plates
  if (
    lower.includes('metal') ||
    lower.includes('gold') ||
    lower.includes('silver') ||
    lower.includes('buckle') ||
    lower.includes('chain') ||
    lower.includes('plate')
  ) {
    return {
      roughness: 0.22,
      metalness: 0.95,
      sheen: 0.0,
      sheenColor: '#ffffff',
      sheenRoughness: 0.0,
    };
  }

  // Sleek synthetic, athletic bodysuits, spandex, latex, stockings, tights, silk, satin
  if (
    lower.includes('suit') ||
    lower.includes('spandex') ||
    lower.includes('latex') ||
    lower.includes('bodysuit') ||
    lower.includes('swim') ||
    lower.includes('stocking') ||
    lower.includes('tight') ||
    lower.includes('silk') ||
    lower.includes('satin') ||
    lower.includes('pantyhose') ||
    lower.includes('hose')
  ) {
    return {
      roughness: 0.38,
      metalness: 0.0,
      sheen: 0.35,
      sheenColor: '#ffffff',
      sheenRoughness: 0.45,
    };
  }

  // Leather, boots, belts, straps, heavy shoes
  if (
    lower.includes('leather') ||
    lower.includes('boot') ||
    lower.includes('shoe') ||
    lower.includes('belt') ||
    lower.includes('strap') ||
    lower.includes('glove')
  ) {
    return {
      roughness: 0.42,
      metalness: 0.0,
      sheen: 0.15,
      sheenColor: '#d0c8be',
      sheenRoughness: 0.6,
    };
  }

  // Denim, jeans, canvas
  if (
    lower.includes('denim') ||
    lower.includes('jean') ||
    lower.includes('canvas') ||
    lower.includes('pant') ||
    lower.includes('short')
  ) {
    return {
      roughness: 0.78,
      metalness: 0.0,
      sheen: 0.45,
      sheenColor: '#e0e6ed',
      sheenRoughness: 0.75,
    };
  }

  // Default: Soft woven cloth, knit sweaters, cotton tops, blouses, dresses, fabrics
  return {
    roughness: 0.82,
    metalness: 0.0,
    sheen: 0.65,
    sheenColor: '#ffffff',
    sheenRoughness: 0.70,
  };
}

/**
 * Applies physical fabric sheen and roughness parameters to a MeshPhysicalMaterial.
 */
export function applyFabricPbr(material: THREE.MeshPhysicalMaterial, name: string = ''): void {
  const profile = detectFabricProfile(name);
  material.roughness = profile.roughness;
  material.metalness = profile.metalness;
  material.sheen = profile.sheen;
  material.sheenColor.set(profile.sheenColor);
  material.sheenRoughness = profile.sheenRoughness;
  if (profile.clearcoat !== undefined) {
    material.clearcoat = profile.clearcoat;
  }
}
