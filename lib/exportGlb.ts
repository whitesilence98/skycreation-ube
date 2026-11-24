'use client';

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { GLTFExporter } from 'three-stdlib';
import * as THREE from 'three';
import { useCharacter } from '@/lib/store';
import { buildExportClips, restInverses } from '@/lib/character/animation';
import { detectFabricProfile } from '@/components/scene/fabricPbr';

export interface ExportOptions {
  /** Include the `Pose` + `Idle` clips. `false` (or omitted) is a static mesh. */
  animated?: boolean;
}

export interface ExportTransform {
  /** Ground elevation, **added** to whatever translation the root node already
   *  carries. The root node is the `character` wrapper, and the body-scale
   *  feature lifts it (`character.position.y = footDrop`) so the feet stay on
   *  the preview floor — that lift is already written by the exporter and must
   *  not be discarded. `computeGroundOffset` measured the world position the
   *  lift produced, so adding the two yields soles at Y=0. */
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  rootName?: string;
}

/**
 * Normalizes raw Skyrim/character mesh names to clean, universal PBR asset names
 * matching commercial standards like Beautiful Asian Girl (e.g. body, face, hair, eyes, etc.).
 */
export function cleanPbrPartName(rawName: string = ''): string {
  const lower = rawName.toLowerCase();
  if (lower === 'baseshape' || lower.includes('baseshape') || lower === 'body') return 'body';
  if (lower.includes('head') || lower.includes('face')) return 'face';
  if (lower.includes('eye') && !lower.includes('lash') && !lower.includes('brow')) return 'eyes';
  if (lower.includes('lash')) return 'eyelashes';
  if (lower.includes('brow')) return 'brows';
  if (lower.includes('mouth') || lower.includes('teeth') || lower.includes('tongue')) return 'mouth';
  if (lower.includes('hand')) return 'hands';
  if (lower.includes('feet') || lower.includes('foot')) return 'feet';
  if (
    lower.includes('hair') ||
    lower.includes('shadow') ||
    lower.includes('s4studio') ||
    lower.includes('empressof') ||
    lower.includes('asterion') ||
    /\bace\b/.test(lower) ||
    /^[1-9]?[hlr]l?_\d*[hlr]/i.test(rawName) ||
    /^[1-9][lr]_/i.test(rawName) ||
    /^mat_([1-9]?[hlr]|a\d|top|braid|brf)/i.test(rawName)
  ) {
    return 'hair';
  }
  if (lower.includes('suit') || lower.includes('bodysuit') || lower.includes('outfit') || lower.includes('cloth') || lower.includes('garment')) {
    return 'outfit';
  }
  if (lower.includes('shirt') || lower.includes('sweater') || lower.includes('top')) {
    return 'shirt';
  }
  if (lower.includes('pant') || lower.includes('jean') || lower.includes('short')) {
    return 'pants';
  }
  if (lower.includes('sock') || lower.includes('stocking') || lower.includes('tight')) {
    return 'socks';
  }
  if (lower.includes('boot') || lower.includes('shoe')) {
    return 'shoes';
  }
  return rawName.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase() || 'material';
}

const CLOTHING_KEYWORDS = [
  'suit', 'cloth', 'garment', 'armor', 'dress', 'pant', 'shirt', 'jean',
  'jacket', 'boot', 'shoe', 'skirt', 'bra', 'panties', 'lingerie', 'bikini',
  'sock', 'stocking', 'tight',
] as const;

const SKIN_KEYWORDS = [
  'femalebody', 'malebody', 'base', 'hand', 'feet', 'foot', 'head', 'face', 'mouth',
] as const;

const HAIR_KEYWORDS = [
  'hair', 's4studio', 'shadow', 'empressof', 'asterion',
] as const;

function classifyExportMaterial(
  matName: string,
  hints?: { alphaMasked?: boolean },
): { lower: string; isLashesOrBrows: boolean; isSkin: boolean; isEyes: boolean; isHair: boolean; isGarment: boolean } {
  const lower = matName.toLowerCase();
  const isLashesOrBrows = lower.includes('lash') || lower.includes('brow');
  const isClothingKeyword = CLOTHING_KEYWORDS.some((kw) => lower.includes(kw));
  const isSkin =
    !isLashesOrBrows &&
    !isClothingKeyword &&
    (lower === 'body' || SKIN_KEYWORDS.some((kw) => lower.includes(kw)));
  const isEyes = !isLashesOrBrows && !isSkin && lower.includes('eye');
  const isHair =
    !isLashesOrBrows &&
    !isSkin &&
    !isEyes &&
    !isClothingKeyword &&
    (HAIR_KEYWORDS.some((kw) => lower.includes(kw)) ||
      /\bace\b/.test(lower) ||
      /^[1-9]?[hlr]l?_\d*[hlr]/i.test(matName) ||
      /^1?[hlr]|^[1-9][lr]_/i.test(matName) ||
      /^mat_([1-9]?[hlr]|a\d|top|braid|brf)/i.test(matName) ||
      Boolean(hints?.alphaMasked));
  const isGarment = !isSkin && !isHair && !isEyes && !isLashesOrBrows;
  return { lower, isLashesOrBrows, isSkin, isEyes, isHair, isGarment };
}

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  min?: number[];
  max?: number[];
}

interface GltfNode {
  name?: string;
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  children?: number[];
  extensions?: Record<string, unknown>;
  [key: string]: unknown;
}

interface GltfSkin {
  name?: string;
  joints: number[];
  skeleton?: number;
  inverseBindMatrices?: number;
}

interface GltfAnimation {
  name?: string;
  samplers?: Array<{ input: number; output: number; interpolation?: string }>;
  channels?: Array<{ sampler: number; target?: { node?: number; path?: string } }>;
}

interface GltfJsonDocument {
  materials?: Array<{
    name?: string;
    pbrMetallicRoughness?: {
      baseColorTexture?: { index: number };
      metallicRoughnessTexture?: { index: number };
      baseColorFactor?: number[];
      roughnessFactor?: number;
      metallicFactor?: number;
    };
    normalTexture?: { index: number };
    alphaMode?: string;
    alphaCutoff?: number;
    doubleSided?: boolean;
    extensions?: Record<string, unknown>;
  }>;
  textures?: Array<{ name?: string; source?: number; sampler?: number }>;
  images?: Array<{ name?: string; uri?: string; bufferView?: number; mimeType?: string }>;
  extensionsUsed?: string[];
  extensions?: Record<string, unknown>;
  nodes?: GltfNode[];
  skins?: GltfSkin[];
  animations?: GltfAnimation[];
  accessors?: GltfAccessor[];
  bufferViews?: Array<{ buffer?: number; byteOffset?: number; byteLength: number; byteStride?: number }>;
  scenes?: Array<{ name?: string; nodes?: number[]; [key: string]: unknown }>;
  scene?: number;
}

const GLTF_FLOAT_COMPONENT_TYPE = 5126;
const GLTF_COMPONENT_COUNTS: Readonly<Record<string, number>> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT4: 16,
};

function transformFloatAccessor(
  json: GltfJsonDocument,
  binView: DataView,
  accIdx: number,
  expectedType: string,
  mutateElement: (read: (c: number) => number, write: (c: number, v: number) => void) => void,
): void {
  const acc = json.accessors?.[accIdx];
  if (!acc || acc.componentType !== GLTF_FLOAT_COMPONENT_TYPE || acc.type !== expectedType) return;
  if (acc.bufferView === undefined) return;
  const bv = json.bufferViews?.[acc.bufferView];
  if (!bv) return;
  const comps = GLTF_COMPONENT_COUNTS[acc.type] ?? 0;
  if (comps === 0) return;

  const baseOffset = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const stride = bv.byteStride ?? comps * 4;
  if (baseOffset + (acc.count > 0 ? (acc.count - 1) * stride + comps * 4 : 0) > binView.byteLength) return;

  const updateBounds = Array.isArray(acc.min) && Array.isArray(acc.max);
  const mins = updateBounds ? new Array<number>(comps).fill(Infinity) : null;
  const maxs = updateBounds ? new Array<number>(comps).fill(-Infinity) : null;

  for (let i = 0; i < acc.count; i++) {
    const elemOffset = baseOffset + i * stride;
    const read = (c: number) => binView.getFloat32(elemOffset + c * 4, true);
    const write = (c: number, v: number) => binView.setFloat32(elemOffset + c * 4, v, true);
    mutateElement(read, write);

    if (mins && maxs) {
      for (let c = 0; c < comps; c++) {
        const val = read(c);
        if (val < mins[c]) mins[c] = val;
        if (val > maxs[c]) maxs[c] = val;
      }
    }
  }

  if (mins && maxs && acc.count > 0) {
    acc.min = mins;
    acc.max = maxs;
  }
}

/**
 * Normalizes any skeleton root carrying a negative-determinant or non-unit uniform
 * scale (e.g. Skyrim NIF Y/Z swap `[-0.01288, +0.01288, +0.01288]` on `Scene Root`)
 * into a right-handed (`det = +1.0`), meter-scale (`[1, 1, 1]`) bone basis inside the
 * exported glTF binary without mutating live Three.js bones or mesh geometry.
 */
function normalizeSkeletonsForPositiveDet(json: GltfJsonDocument, binDataView: DataView): void {
  const nodes = json.nodes;
  const skins = json.skins;
  if (!nodes || !skins || skins.length === 0) return;

  const parentOf = new Map<number, number>();
  for (let i = 0; i < nodes.length; i++) {
    for (const childIdx of nodes[i].children ?? []) {
      parentOf.set(childIdx, i);
    }
  }

  const allJoints = new Set<number>();
  const rootCandidates = new Set<number>();
  for (const skin of skins) {
    for (const j of skin.joints) allJoints.add(j);
    if (skin.skeleton !== undefined) {
      rootCandidates.add(skin.skeleton);
    } else if (skin.joints.length > 0) {
      const skinJointSet = new Set(skin.joints);
      let curr = skin.joints[0];
      while (parentOf.has(curr) && skinJointSet.has(parentOf.get(curr)!)) {
        curr = parentOf.get(curr)!;
      }
      rootCandidates.add(curr);
    }
  }

  const updatedIbmAccessors = new Set<number>();
  const updatedAnimAccessors = new Set<number>();

  for (const rootIdx of rootCandidates) {
    const rootNode = nodes[rootIdx];
    if (!rootNode?.scale) continue;
    const [sx, sy, sz] = rootNode.scale;
    const det = sx * sy * sz;
    const ax = Math.abs(sx);
    const ay = Math.abs(sy);
    const az = Math.abs(sz);
    const maxAbs = Math.max(ax, ay, az);

    // Skip skeletons that already have positive unit scale or zero/degenerate scale
    if (maxAbs < 1e-6) continue;
    if (det > 0 && Math.abs(sx - 1) < 1e-4 && Math.abs(sy - 1) < 1e-4 && Math.abs(sz - 1) < 1e-4) {
      continue;
    }
    // Require uniform scale magnitude so quaternion conjugation preserves exact SO(3) rotations
    if (Math.max(Math.abs(ax - ay), Math.abs(ay - az)) > 0.002 * maxAbs) {
      continue;
    }

    // Collect every descendant node of this skeleton root
    const descendants = new Set<number>();
    const stack = [...(rootNode.children ?? [])];
    while (stack.length > 0) {
      const idx = stack.pop()!;
      if (descendants.has(idx)) continue;
      descendants.add(idx);
      for (const ch of nodes[idx]?.children ?? []) {
        stack.push(ch);
      }
    }

    // Abort safely if any non-joint mesh lives directly under this bone subtree
    let hasNonJointChild = false;
    for (const d of descendants) {
      if (!allJoints.has(d) && (nodes[d]?.mesh !== undefined || nodes[d]?.camera !== undefined)) {
        hasNonJointChild = true;
        break;
      }
    }
    if (hasNonJointChild) continue;

    // Conjugating R(x,y,z,w) by Q = diag(qx,qy,qz) flips axes according to det(Q) * Q
    const qx = sx < 0 ? -1 : 1;
    const qy = sy < 0 ? -1 : 1;
    const qz = sz < 0 ? -1 : 1;
    const detQ = qx * qy * qz;
    const rxMul = detQ * qx;
    const ryMul = detQ * qy;
    const rzMul = detQ * qz;

    // 1. Reset root joint scale to positive unit meter scale [1, 1, 1]
    rootNode.scale = [1, 1, 1];

    // 2. Transform descendant rest translations & rotations into the new bone basis
    for (const d of descendants) {
      const dn = nodes[d];
      if (!dn) continue;
      if (dn.translation && dn.translation.length >= 3) {
        dn.translation = [sx * dn.translation[0], sy * dn.translation[1], sz * dn.translation[2]];
      }
      if (dn.rotation && dn.rotation.length >= 4) {
        dn.rotation = [
          rxMul * dn.rotation[0],
          ryMul * dn.rotation[1],
          rzMul * dn.rotation[2],
          dn.rotation[3],
        ];
      }
    }

    // 3. Left-multiply inverseBindMatrices by D = diag(sx, sy, sz, 1) (rows 0, 1, 2 in col-major)
    for (const skin of skins) {
      const ibmIdx = skin.inverseBindMatrices;
      if (ibmIdx === undefined || updatedIbmAccessors.has(ibmIdx)) continue;
      if (!skin.joints.every((j) => j === rootIdx || descendants.has(j))) continue;
      updatedIbmAccessors.add(ibmIdx);
      transformFloatAccessor(json, binDataView, ibmIdx, 'MAT4', (read, write) => {
        for (let col = 0; col < 4; col++) {
          const base = col * 4;
          write(base, read(base) * sx);
          write(base + 1, read(base + 1) * sy);
          write(base + 2, read(base + 2) * sz);
        }
      });
    }

    // 4. Transform animation channels targeting descendant joints equivalently
    for (const anim of json.animations ?? []) {
      const samplers = anim.samplers ?? [];
      for (const ch of anim.channels ?? []) {
        const nodeIdx = ch.target?.node;
        const path = ch.target?.path;
        if (nodeIdx === undefined || !descendants.has(nodeIdx)) continue;
        const outIdx = samplers[ch.sampler]?.output;
        if (outIdx === undefined || updatedAnimAccessors.has(outIdx)) continue;

        if (path === 'translation') {
          updatedAnimAccessors.add(outIdx);
          transformFloatAccessor(json, binDataView, outIdx, 'VEC3', (read, write) => {
            write(0, read(0) * sx);
            write(1, read(1) * sy);
            write(2, read(2) * sz);
          });
        } else if (path === 'rotation') {
          updatedAnimAccessors.add(outIdx);
          transformFloatAccessor(json, binDataView, outIdx, 'VEC4', (read, write) => {
            write(0, read(0) * rxMul);
            write(1, read(1) * ryMul);
            write(2, read(2) * rzMul);
          });
        }
      }
    }
  }
}

/**
 * Post-processes GLB binary:
 * - If a custom IOR is explicitly provided (and not 1.5), injects `KHR_materials_ior`.
 *   Otherwise, standard glTF 2.0 / Blender default IOR (1.5) is preserved.
 * - Normalizes skeleton root scales to right-handed positive-determinant meter space.
 * - Injects root elevation (soles at Y=0.0) and front-facing rotation directly
 *   into the glTF root node, eliminating the need to mutate the live character in
 *   the Three.js viewport (which would cause the camera to snap/look down at the feet).
 */
export function patchGlbIor(
  glbBuffer: ArrayBuffer,
  iorOrTransform?: number | ExportTransform,
  transformArg?: ExportTransform,
): ArrayBuffer {
  let ior: number | undefined;
  let transform: ExportTransform | undefined;

  if (typeof iorOrTransform === 'number') {
    ior = iorOrTransform;
    transform = transformArg;
  } else {
    transform = iorOrTransform;
  }

  const view = new DataView(glbBuffer);
  const jsonLen = view.getUint32(12, true);
  const jsonStart = 20;
  const jsonBytes = new Uint8Array(glbBuffer, jsonStart, jsonLen);
  const json = JSON.parse(new TextDecoder().decode(jsonBytes)) as GltfJsonDocument;

  if (ior !== undefined && ior !== 1.5 && json.materials) {
    for (const mat of json.materials) {
      mat.extensions = mat.extensions ?? {};
      mat.extensions['KHR_materials_ior'] = { ior };
    }
    json.extensionsUsed = [
      ...new Set([...(json.extensionsUsed ?? []), 'KHR_materials_ior']),
    ];
  }

  // 1. Inject high-fidelity PBR extensions matching Beautiful Asian Girl
  if (json.materials) {
    for (const mat of json.materials) {
      const matName = mat.name || '';
      const { lower, isLashesOrBrows, isSkin, isEyes, isHair } = classifyExportMaterial(matName, {
        alphaMasked: mat.alphaMode === 'MASK',
      });

      mat.extensions = mat.extensions ?? {};

      if (isLashesOrBrows) {
        // Lashes and brows stay crisp alpha-tested masks without fabric sheen or specular haze
        mat.alphaMode = 'MASK';
        mat.alphaCutoff = lower.includes('brow') ? 0.18 : 0.25;
        mat.doubleSided = true;
        mat.extensions['KHR_materials_specular'] = { specularFactor: 0.2 };
        json.extensionsUsed = [
          ...new Set([...(json.extensionsUsed ?? []), 'KHR_materials_specular']),
        ];
      } else if (isSkin) {
        // Guarantee skin parts are explicitly marked OPAQUE in glTF so external
        // importers like Blender don't default to dithered/hashed transparency for 4-channel PNGs
        mat.alphaMode = 'OPAQUE';
        delete mat.alphaCutoff;

        // Subsurface scattering: warm dermal light diffusion
        mat.extensions['KHR_materials_subsurface'] = {
          subsurfaceWeight: 0.55,
          subsurfaceColor: [1.0, 0.62, 0.5],
          subsurfaceRadius: [0.85, 0.3, 0.12],
        };
        // Accurate human skin IOR & soft dermal specular reflectance (~0.028 F0 vs default 0.04 plastic)
        mat.extensions['KHR_materials_ior'] = { ior: 1.45 };
        mat.extensions['KHR_materials_specular'] = { specularFactor: 0.38 };

        // NOTE: KHR_materials_sheen is omitted on skin to prevent Blender Principled BSDF
        // from applying a 100% white Charlie sheen (cloth/velvet fuzz) across human skin.
        json.extensionsUsed = [
          ...new Set([
            ...(json.extensionsUsed ?? []),
            'KHR_materials_subsurface',
            'KHR_materials_ior',
            'KHR_materials_specular',
          ]),
        ];
      } else if (isHair) {
        // Guarantee hair clump transparency (alphaMode: MASK) so Blender renders fine strands
        if (!mat.alphaMode || mat.alphaMode === 'OPAQUE') {
          mat.alphaMode = 'MASK';
          mat.alphaCutoff = 0.35;
          mat.doubleSided = true;
        }
        // Soften hair card specular response so curved crowns keep rich dyed pigment without salt-pepper glare
        mat.extensions['KHR_materials_specular'] = { specularFactor: 0.25 };
        json.extensionsUsed = [
          ...new Set([...(json.extensionsUsed ?? []), 'KHR_materials_specular']),
        ];
        // NOTE: KHR_materials_anisotropy is omitted when hair cards lack TANGENT vertex
        // attributes, preventing Blender from computing noisy radial white specular glare.
      } else if (isEyes) {
        mat.alphaMode = 'OPAQUE';
        delete mat.alphaCutoff;
        // Wet corneal IOR and clear specular
        mat.extensions['KHR_materials_ior'] = { ior: 1.376 };
        mat.extensions['KHR_materials_specular'] = {
          specularFactor: 1.0,
          specularColorFactor: [1.0, 1.0, 1.0],
        };
        json.extensionsUsed = [
          ...new Set([
            ...(json.extensionsUsed ?? []),
            'KHR_materials_ior',
            'KHR_materials_specular',
          ]),
        ];
      } else {
        // Garments and clothing are opaque solids unless already masked
        if (!mat.alphaMode) {
          mat.alphaMode = 'OPAQUE';
        }
        // Omit KHR_materials_sheen: Blender's glTF importer forces Sheen Weight=1.0
        // whenever present, washing garment shadows out with white microfiber haze.
        // Instead use calibrated dielectric specular for non-metallic fabrics.
        const profile = detectFabricProfile(mat.name || '');
        if (profile.metalness <= 0.5) {
          mat.extensions['KHR_materials_specular'] = { specularFactor: 0.28 };
          json.extensionsUsed = [
            ...new Set([...(json.extensionsUsed ?? []), 'KHR_materials_specular']),
          ];
        }
      }

      // Safeguard PBR factors:
      const pbr = mat.pbrMetallicRoughness;
      if (pbr) {
        // Prevent dark baseColorFactor from crushing textured materials (hair, skin) into black mud in Blender
        if (pbr.baseColorTexture && pbr.baseColorFactor) {
          const [r, g, b] = pbr.baseColorFactor;
          if (r < 0.8 || g < 0.8 || b < 0.8) {
            pbr.baseColorFactor = [1.0, 1.0, 1.0, pbr.baseColorFactor[3] ?? 1.0];
          }
        }
        // Force metallicFactor to 0.0 for all dielectric organic parts (skin, hair, eyes, brows, lashes)
        if (isSkin || isHair || isEyes || isLashesOrBrows) {
          pbr.metallicFactor = 0.0;
        }
      }
    }
  }

  // 2. Semantic Texture & Image Naming (matching standard PBR conventions: body_basecolor, face_basecolor, hair_basecolor, etc.)
  if (json.materials && json.textures && json.images) {
    const images = json.images;
    const textures = json.textures;
    for (const mat of json.materials) {
      const matName = cleanPbrPartName(mat.name || '');
      mat.name = matName;
      const pbr = mat.pbrMetallicRoughness;
      if (pbr?.baseColorTexture) {
        const tex = textures[pbr.baseColorTexture.index];
        if (tex) {
          tex.name = `${matName}_basecolor`;
          if (tex.source !== undefined && images[tex.source]) {
            images[tex.source].name = `${matName}_basecolor`;
          }
        }
      }
      if (pbr?.metallicRoughnessTexture) {
        const tex = textures[pbr.metallicRoughnessTexture.index];
        if (tex) {
          tex.name = `${matName}_roughness`;
          if (tex.source !== undefined && images[tex.source]) {
            images[tex.source].name = `${matName}_roughness`;
          }
        }
      }
      if (mat.normalTexture) {
        const tex = textures[mat.normalTexture.index];
        if (tex) {
          tex.name = `${matName}_normal`;
          if (tex.source !== undefined && images[tex.source]) {
            images[tex.source].name = `${matName}_normal`;
          }
        }
      }
    }
  }

  // 3. Inject embedded 3-Point Studio Lighting (Key, Rim, Fill) via KHR_lights_punctual
  if (json.nodes && json.scenes && json.scenes.length > 0) {
    json.extensions = json.extensions ?? {};
    // glTF light intensity is in candela (cd = lm/sr); Blender's importer divides by ~54.35
    // (PBR_WATTS_TO_LUMENS / (4*pi)) to convert candela into Blender Watts.
    json.extensions['KHR_lights_punctual'] = {
      lights: [
        {
          name: 'Key Light',
          type: 'spot',
          color: [0.98, 0.95, 0.92],
          intensity: 14000.0,
          spot: {
            innerConeAngle: 0.45,
            outerConeAngle: 0.85,
          },
        },
        {
          name: 'Rim Light',
          type: 'spot',
          color: [0.88, 0.96, 1.0],
          intensity: 5400.0,
          spot: {
            innerConeAngle: 0.5,
            outerConeAngle: 0.9,
          },
        },
        {
          name: 'Fill Light',
          type: 'point',
          color: [1.0, 1.0, 1.0],
          intensity: 3800.0,
        },
      ],
    };
    json.extensionsUsed = [
      ...new Set([...(json.extensionsUsed ?? []), 'KHR_lights_punctual']),
    ];

    const activeScene = json.scenes[json.scene ?? 0];
    if (activeScene) {
      activeScene.nodes = activeScene.nodes ?? [];

      const keyIdx = json.nodes.length;
      json.nodes.push({
        name: 'Key_StudioLight',
        translation: [0.3, 2.2, -3.2],
        rotation: [-0.006, 0.9906, 0.1288, 0.0463],
        extensions: { KHR_lights_punctual: { light: 0 } },
      });

      const rimIdx = json.nodes.length;
      json.nodes.push({
        name: 'Rim_StudioLight',
        translation: [0.7, 1.8, 2.2],
        rotation: [-0.095, 0.1527, 0.0147, 0.9836],
        extensions: { KHR_lights_punctual: { light: 1 } },
      });

      const fillIdx = json.nodes.length;
      json.nodes.push({
        name: 'Fill_StudioLight',
        translation: [-1.6, 1.35, -2.2],
        extensions: { KHR_lights_punctual: { light: 2 } },
      });

      activeScene.nodes.push(keyIdx, rimIdx, fillIdx);
    }
  }

  if (transform && json.nodes && json.nodes.length > 0) {
    let rootNode: GltfNode | undefined;
    if (transform.rootName) {
      rootNode = json.nodes.find((n) => n.name === transform.rootName);
    }
    if (!rootNode && json.scenes && json.scenes.length > 0) {
      const activeScene = json.scenes[json.scene ?? 0];
      if (activeScene && activeScene.nodes && activeScene.nodes.length > 0) {
        rootNode = json.nodes[activeScene.nodes[0]];
      }
    }
    if (!rootNode) {
      rootNode = json.nodes[0];
    }
    if (rootNode) {
      if (transform.translation) {
        /* ADD to the exporter's own root translation, never replace it: the
           `character` wrapper is lifted by `footDrop` in the live scene so the
           soles sit on the preview floor, and GLTFExporter already serialised
           that lift. `computeGroundOffset` measured the world minima *after*
           the lift, so the correct soles-at-0 translation is the lift plus the
           measured offset. Overwriting dropped the lift and sank the character
           by `footDrop`. */
        const existing = rootNode.translation ?? [0, 0, 0];
        rootNode.translation = [
          (existing[0] ?? 0) + transform.translation[0],
          (existing[1] ?? 0) + transform.translation[1],
          (existing[2] ?? 0) + transform.translation[2],
        ];
      }
      if (transform.rotation) {
        rootNode.rotation = transform.rotation;
      }
      if (transform.rootName) {
        rootNode.name = transform.rootName;
      }
    }
  }

  // BIN chunk starts right after the original JSON chunk (8-byte header + buffer payload)
  const binChunkStart = jsonStart + jsonLen;
  const binChunkCopy = new Uint8Array(glbBuffer.slice(binChunkStart));
  if (binChunkCopy.byteLength > 8) {
    const binPayloadView = new DataView(
      binChunkCopy.buffer,
      binChunkCopy.byteOffset + 8,
      binChunkCopy.byteLength - 8,
    );
    normalizeSkeletonsForPositiveDet(json, binPayloadView);
  }

  const newJsonEncoded = new TextEncoder().encode(JSON.stringify(json));
  // Pad to 4-byte alignment with spaces (0x20) as required by glTF spec
  const paddedLen = Math.ceil(newJsonEncoded.length / 4) * 4;
  const paddedJson = new Uint8Array(paddedLen).fill(0x20);
  paddedJson.set(newJsonEncoded);

  const newTotal = 12 + 8 + paddedLen + binChunkCopy.length;
  const out = new ArrayBuffer(newTotal);
  const outView = new DataView(out);
  const outBytes = new Uint8Array(out);

  // GLB header
  outView.setUint32(0, 0x46546c67, true); // magic "glTF"
  outView.setUint32(4, 2, true);           // version 2
  outView.setUint32(8, newTotal, true);    // total byte length

  // JSON chunk header + data
  outView.setUint32(12, paddedLen, true);   // chunk length
  outView.setUint32(16, 0x4e4f534a, true); // chunk type JSON
  outBytes.set(paddedJson, 20);

  // BIN chunk (header + normalized binary buffer)
  outBytes.set(binChunkCopy, 20 + paddedLen);

  return out;
}

type ExportHandler = (customName?: string, options?: ExportOptions) => Promise<void>;

let activeHandler: ExportHandler | null = null;

/**
 * A second export would run discovery against a scene the first export has
 * already mutated (hidden collision bones, pruned skeleton bindings), so
 * overlap is refused rather than serialised. Cleared by the export's
 * `finally`, including on failure.
 */
let exportInFlight = false;

export function isExportInFlight(): boolean {
  return exportInFlight;
}

export function setExportInFlight(val: boolean): void {
  exportInFlight = val;
}

export function registerExportHandler(handler: ExportHandler) {
  activeHandler = handler;
}

export function unregisterExportHandler() {
  activeHandler = null;
}

/**
 * Trigger export of the full 3D character model with rig as a `.glb` binary.
 *
 * `options.animated` adds a `Pose` clip (the selected stance) and an `Idle`
 * clip (breathing layered over that stance). Omitting it exports the static
 * mesh with no animation, as before.
 */
export async function exportCharacterGlb(
  customName?: string,
  options?: ExportOptions,
): Promise<void> {
  const opts: ExportOptions = { animated: true, ...options };
  if (activeHandler) {
    return activeHandler(customName, opts);
  }
  throw new Error('3D scene is not ready for export. Please wait for model to load.');
}

/**
 * Computes the vertical distance needed to lift the character so that the
 * lowest point of the soles sits precisely at Y = 0.0 on the ground plane.
 */
export function computeGroundOffset(character: THREE.Object3D): number {
  let minY = Infinity;
  const tempVec = new THREE.Vector3();

  character.traverse((child) => {
    if (
      (child as THREE.Mesh).isMesh &&
      child.visible &&
      child.name !== 'face-gizmo' &&
      child.name !== 'mesh-overlay' &&
      !child.userData?.isHelper
    ) {
      const mesh = child as THREE.Mesh;
      const geo = mesh.geometry;
      if (!geo || !geo.attributes || !geo.attributes.position) return;
      const pos = geo.attributes.position;
      const arr = pos.array;
      const mat = mesh.matrixWorld;
      for (let i = 0; i < arr.length; i += 3) {
        tempVec.set(arr[i], arr[i + 1], arr[i + 2]).applyMatrix4(mat);
        if (tempVec.y < minY) {
          minY = tempVec.y;
        }
      }
    }
  });

  if (Number.isFinite(minY) && minY < -0.3) {
    return -minY;
  }
  return 1.554;
}

/**
 * Traverses skinned meshes to collect all bones with non-zero vertex weights,
 * plus all their ancestor bones up to the root.
 */
export function findEssentialBones(
  skinnedMeshes: THREE.SkinnedMesh[],
  headBone: THREE.Bone | null,
  rootBone: THREE.Bone | null,
): Set<THREE.Bone> {
  const essential = new Set<THREE.Bone>();

  if (headBone) essential.add(headBone);
  if (rootBone) essential.add(rootBone);

  for (const mesh of skinnedMeshes) {
    const geo = mesh.geometry;
    const skinWeight = geo.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;
    const skinIndex = geo.getAttribute('skinIndex') as THREE.BufferAttribute | undefined;
    const bones = mesh.skeleton?.bones;

    if (!skinWeight || !skinIndex || !bones) continue;

    const wArr = skinWeight.array;
    const iArr = skinIndex.array;

    for (let i = 0; i < wArr.length; i++) {
      if (wArr[i] > 0.0001) {
        const boneIdx = iArr[i];
        if (boneIdx < bones.length) {
          const bone = bones[boneIdx];
          if (bone) essential.add(bone);
        }
      }
    }
  }

  // Include all ancestors up to the root so the skeleton hierarchy stays complete
  const ancestorsToAdd: THREE.Bone[] = [];
  for (const bone of essential) {
    let curr: THREE.Object3D | null = bone.parent;
    while (curr) {
      if ((curr as any).isBone) {
        ancestorsToAdd.push(curr as THREE.Bone);
      }
      curr = curr.parent;
    }
  }
  for (const b of ancestorsToAdd) {
    essential.add(b);
  }

  return essential;
}


/** Cache packed metallic-roughness textures across meshes sharing the same maps (e.g. skin parts) */
const packedTextureCache = new Map<THREE.Texture | string, THREE.Texture>();

/**
 * Bakes material color tint (hair tone, brow color, lash tint, skin tint) directly
 * into a diffuse texture's RGB pixels in sRGB space so the exported glTF image
 * carries the exact author-selected color cleanly into Blender/Unreal/Unity,
 * without relying on baseColorFactor (which causes dark multiply crushing or
 * missing tints across engines).
 */
export function buildTintedDiffuseTexture(
  baseMap: THREE.Texture,
  tint: THREE.Color,
): THREE.Texture {
  // THREE.Color stores linear-sRGB; convert to display sRGB before multiplying sRGB canvas bytes.
  const srgbTint = tint.clone().convertLinearToSRGB();
  if (srgbTint.r >= 0.995 && srgbTint.g >= 0.995 && srgbTint.b >= 0.995) return baseMap;

  const cacheKey = `tinted_${baseMap.uuid || baseMap.name}_${tint.getHexString()}`;
  if (packedTextureCache.has(cacheKey)) {
    return packedTextureCache.get(cacheKey)!;
  }

  try {
    const img = baseMap.image as HTMLImageElement | HTMLCanvasElement | ImageBitmap | null | undefined;
    if (!img) return baseMap;

    if ((img as any).crossOrigin !== 'anonymous') {
      try { (img as any).crossOrigin = 'anonymous'; } catch {}
    }

    const width = (img as any).naturalWidth || img.width || 1024;
    const height = (img as any).naturalHeight || img.height || 1024;
    if (width === 0 || height === 0 || typeof document === 'undefined') return baseMap;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return baseMap;

    ctx.drawImage(img, 0, 0, width, height);
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    const tr = Math.max(0, Math.min(1, srgbTint.r));
    const tg = Math.max(0, Math.min(1, srgbTint.g));
    const tb = Math.max(0, Math.min(1, srgbTint.b));

    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.round(data[i] * tr);
      data[i + 1] = Math.round(data[i + 1] * tg);
      data[i + 2] = Math.round(data[i + 2] * tb);
      // Alpha (data[i + 3]) is strictly preserved
    }
    ctx.putImageData(imgData, 0, 0);

    const tintedTexture = new THREE.CanvasTexture(canvas);
    tintedTexture.name = `${baseMap.name || 'diffuse'}_tinted`;
    tintedTexture.wrapS = baseMap.wrapS;
    tintedTexture.wrapT = baseMap.wrapT;
    // CRITICAL: Preserve flipY (GLB hair textures use flipY=false; webp/png atlases use flipY=true).
    // GLTFExporter reads texture.flipY directly when serializing to PNG!
    tintedTexture.flipY = baseMap.flipY;
    tintedTexture.repeat.copy(baseMap.repeat);
    tintedTexture.offset.copy(baseMap.offset);
    tintedTexture.colorSpace = THREE.SRGBColorSpace;
    tintedTexture.needsUpdate = true;

    packedTextureCache.set(cacheKey, tintedTexture);
    packedTextureCache.set(tintedTexture, tintedTexture);
    return tintedTexture;
  } catch (err) {
    console.warn('[exportGlb] Failed to bake tinted diffuse texture, using raw map:', err);
    return baseMap;
  }
}

/**
 * Pre-bakes a canonical glTF 2.0 metallicRoughnessTexture canvas:
 *   - Green channel: Roughness (from roughnessMap green/luminance, or defaultRoughness)
 *   - Blue channel:  Metalness (from metalnessMap blue, or defaultMetalness; 0 for skin)
 *   - Red channel:   0 (unused in glTF standard PBR)
 * 
 * In three-stdlib's GLTFExporter, having a roughnessMap without a metalnessMap triggers a bug
 * where GLTFExporter initializes the bake canvas with #00ffff (100% metalness), making organic
 * character skin look like a chrome statue.
 * 
 * By pre-baking this texture and setting BOTH mat.roughnessMap and mat.metalnessMap to the same
 * packed texture instance, GLTFExporter recognizes `metalnessMap === roughnessMap` and serializes
 * it directly without touching the bugged #00ffff path. Blender's glTF importer then automatically
 * connects the Green channel to the Principled BSDF Roughness socket and keeps metalness at 0.0.
 */
export function buildPackedMetalRoughnessTexture(
  roughnessMap: THREE.Texture | null | undefined,
  metalnessMap: THREE.Texture | null | undefined,
  defaultRoughness: number,
  defaultMetalness: number = 0.0,
): THREE.Texture | null {
  // If neither texture is provided, return null to use glTF scalar factors
  if (!roughnessMap && !metalnessMap) return null;

  const cacheKey = roughnessMap || metalnessMap;
  if (cacheKey && packedTextureCache.has(cacheKey)) {
    return packedTextureCache.get(cacheKey)!;
  }

  try {
    const rImg = roughnessMap?.image as (HTMLImageElement | HTMLCanvasElement | ImageBitmap | undefined) | null;
    const mImg = metalnessMap?.image as (HTMLImageElement | HTMLCanvasElement | ImageBitmap | undefined) | null;

    if (rImg && (rImg as any).crossOrigin !== 'anonymous') {
      try { (rImg as any).crossOrigin = 'anonymous'; } catch {}
    }
    if (mImg && (mImg as any).crossOrigin !== 'anonymous') {
      try { (mImg as any).crossOrigin = 'anonymous'; } catch {}
    }

    const rWidth = (rImg as any)?.naturalWidth || rImg?.width || 0;
    const rHeight = (rImg as any)?.naturalHeight || rImg?.height || 0;
    const mWidth = (mImg as any)?.naturalWidth || mImg?.width || 0;
    const mHeight = (mImg as any)?.naturalHeight || mImg?.height || 0;

    const width = Math.max(rWidth, mWidth);
    const height = Math.max(rHeight, mHeight);

    if (width === 0 || height === 0) return null;
    if (typeof document === 'undefined') return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const defaultR = Math.max(0, Math.min(255, Math.round(defaultRoughness * 255)));
    const defaultM = Math.max(0, Math.min(255, Math.round(defaultMetalness * 255)));

    let rData: Uint8ClampedArray | null = null;
    if (rImg) {
      ctx.drawImage(rImg, 0, 0, width, height);
      rData = ctx.getImageData(0, 0, width, height).data;
    }

    let mData: Uint8ClampedArray | null = null;
    if (mImg) {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(mImg, 0, 0, width, height);
      mData = ctx.getImageData(0, 0, width, height).data;
    }

    const outImgData = ctx.createImageData(width, height);
    const out = outImgData.data;

    for (let i = 0; i < out.length; i += 4) {
      out[i] = 255; // Red channel = Ambient Occlusion (255 = fully unoccluded in glTF PBR standard)
      // In Three.js and Skyrim, roughnessMap is an intensity multiplier for scalar roughness.
      // In glTF PBR standard, the Green channel must directly carry the final physical roughness [0..255].
      // Multiply the normalized mask by defaultRoughness so the Green channel has calibrated PBR values (~0.45 - 0.55).
      const rawRough = rData ? (rData[i + 1] ?? rData[i]) / 255.0 : 1.0;
      out[i + 1] = Math.max(0, Math.min(255, Math.round(rawRough * defaultRoughness * 255)));
      // Blue channel = Metalness (0 for organic skin)
      out[i + 2] = mData ? mData[i + 2] : defaultM;
      out[i + 3] = 255;
    }

    ctx.putImageData(outImgData, 0, 0);

    const packed = new THREE.CanvasTexture(canvas);
    const ref = roughnessMap || metalnessMap;
    if (ref) {
      packed.wrapS = ref.wrapS;
      packed.wrapT = ref.wrapT;
      packed.flipY = ref.flipY;
      packed.repeat.copy(ref.repeat);
      packed.offset.copy(ref.offset);
    }
    packed.colorSpace = THREE.NoColorSpace;
    packed.needsUpdate = true;

    if (cacheKey) {
      packedTextureCache.set(cacheKey, packed);
    }
    packedTextureCache.set(packed, packed);
    return packed;
  } catch (err) {
    console.warn('Failed to pack metallic-roughness texture, falling back to direct texture:', err);
    if (roughnessMap) return roughnessMap;
    return null;
  }
}

/**
 * Binds a mesh to the single head bone of the unified skeleton.
 */
export function createHeadSkinnedMesh(
  mesh: THREE.Mesh,
  name: string,
  rootBone: THREE.Bone,
  headBone: THREE.Bone,
  restHeadWorld: THREE.Matrix4,
): THREE.SkinnedMesh {
  const geo = mesh.geometry.clone();
  const count = geo.attributes.position.count;
  if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
    // Bake facial deformation before replacing facial weights with the unified head bone.
    // Attached binding cancels the animated root, leaving positions in head-local space.
    mesh.updateWorldMatrix(true, false);
    const position = geo.getAttribute('position');
    const point = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      mesh.getVertexPosition(i, point);
      position.setXYZ(i, point.x, point.y, point.z);
    }
    position.needsUpdate = true;
    geo.computeVertexNormals();
  }

  // Vertex skinning: index 1 is headBone, weight 1.0
  const skinIndices = new Uint16Array(count * 4);
  const skinWeights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    skinIndices[i * 4] = 1;
    skinWeights[i * 4] = 1.0;
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndices, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeights, 4));

  const boneInverses = [
    rootBone.matrixWorld.clone().invert(),
    restHeadWorld.clone().invert(),
  ];
  const skeleton = new THREE.Skeleton([rootBone, headBone], boneInverses);

  // Clone material and assign explicit semantic name; sanitize() in Step 4.5
  // handles canonical tint-baking & ORM packing once across both head and body.
  const origMat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial | undefined;
  const isSkin = name === 'Face' || name === 'Head' || name === 'Mouth';
  const isEyes = name === 'Eyes';
  const isAlpha = name === 'Lashes' || name === 'Brows';
  const defaultR = isEyes ? 0.04 : (isSkin ? 0.55 : (origMat?.roughness ?? 0.6));

  const mat = new THREE.MeshStandardMaterial({
    name,
    color: origMat?.color ? origMat.color.clone() : new THREE.Color(1, 1, 1),
    map: origMat?.map ?? null,
    normalMap: origMat?.normalMap ?? null,
    normalScale: origMat?.normalScale ? origMat.normalScale.clone() : new THREE.Vector2(1, 1),
    roughness: defaultR,
    metalness: 0.0,
    roughnessMap: origMat?.roughnessMap ?? null,
    metalnessMap: origMat?.metalnessMap ?? null,
    // Hair, lashes and brows MUST use transparent: false with alphaTest > 0
    // so GLTFExporter emits alphaMode: "MASK". transparent: true forces "BLEND" which makes
    // them completely invisible / ghost transparent in Blender EEVEE.
    transparent: false,
    opacity: origMat?.opacity ?? 1.0,
    alphaTest: isAlpha ? (name === 'Brows' ? 0.18 : 0.25) : 0,
    side: isAlpha ? THREE.DoubleSide : (origMat?.side ?? THREE.FrontSide),
    visible: origMat?.visible !== false,
  });

  const skinned = new THREE.SkinnedMesh(geo, mat);
  skinned.name = name;
  skinned.castShadow = true;
  skinned.receiveShadow = true;
  skinned.bind(skeleton, new THREE.Matrix4());
  return skinned;
}

/**
 * Export the character scene to `.glb`, mutating the live scene only inside a
 * single `try`, with every mutation undone by `finally`.
 *
 * Two invariants keep the preview intact if the exporter throws:
 *
 *  - **Every mutation has a recorded undo before it is performed.** Visibility
 *    changes push the object (and it is re-shown from the recorded original,
 *    not assumed to have been visible), skeleton re-binding pushes a restore
 *    closure, and temp facial meshes push themselves for removal.
 *  - **Discovery runs before the first mutation.** Lookups that can throw
 *    (missing character/skeleton/root bone) leave the scene untouched.
 *
 * The function is exported for the headless export check; the bridge is a thin
 * wrapper around it.
 */
export async function exportCharacterScene(
  scene: THREE.Scene,
  customName?: string,
  options?: ExportOptions,
): Promise<void> {
  if (exportInFlight) {
    throw new Error('Export already in progress.');
  }

  const character = scene.getObjectByName('character');
  if (!character) {
    throw new Error('Character model not found in scene.');
  }

  const origPos = character.position.clone();
  const origRot = character.rotation.clone();
  const origName = character.name;

  // ── Discovery: read-only, may throw, nothing has been mutated yet ───────
  const skeletonGroup = character.getObjectByName('SkeletonRoot');
  if (!skeletonGroup) {
    throw new Error('Character skeleton not found in scene.');
  }

  let rootBone: THREE.Bone | null = null;
  skeletonGroup.traverse((child) => {
    if (!rootBone && (child as any).isBone && (!child.parent || !(child.parent as any).isBone)) {
      rootBone = child as THREE.Bone;
    }
  });
  if (!rootBone) {
    rootBone = skeletonGroup.children.find((c) => (c as any).isBone) as THREE.Bone | null;
  }
  if (!rootBone) {
    throw new Error('Skeleton root bone not found.');
  }

  const headBone = (skeletonGroup.getObjectByName('NPC Head [Head]') || rootBone) as THREE.Bone;
  const restHeadWorld = headBone.userData.__boneRest?.world
    ? (headBone.userData.__boneRest.world as THREE.Matrix4).clone()
    : headBone.matrixWorld.clone();
  const headRoot = character.getObjectByName('SkyrimHeadRoot');

  const bodySkinnedMeshes: THREE.SkinnedMesh[] = [];
  character.traverse((child) => {
    if ((child as any).isSkinnedMesh && child.parent !== headRoot) {
      bodySkinnedMeshes.push(child as THREE.SkinnedMesh);
    }
  });

  const essentialBones = findEssentialBones(bodySkinnedMeshes, headBone, rootBone!);
  const essentialList = Array.from(essentialBones);

  // ── Mutation phase: everything below runs inside one try/finally ────────
  /** Objects hidden for the export, with the visibility they had before it. */
  const hidden: { object: THREE.Object3D; wasVisible: boolean }[] = [];
  const hide = (object: THREE.Object3D) => {
    hidden.push({ object, wasVisible: object.visible });
    object.visible = false;
  };
  const restoreMeshSkeletons: (() => void)[] = [];
  const tempFacialMeshes: THREE.SkinnedMesh[] = [];
  const restoreMaterials: Array<{ mesh: THREE.Mesh; origMaterial: THREE.Material | THREE.Material[] }> = [];
  const restoreGroups: Array<{ mesh: THREE.Mesh; origGroups: THREE.BufferGeometry['groups'] }> = [];
  const tempTextures: THREE.Texture[] = [];
  packedTextureCache.clear();

  exportInFlight = true;
  try {
    // 1. Hide dummy collision bones that no mesh weights and the export drops.
    skeletonGroup.traverse((child) => {
      if ((child as any).isBone && !essentialBones.has(child as THREE.Bone) && child.visible) {
        hide(child);
      }
    });

    // 2. Prune those bones from each body SkinnedMesh skeleton.
    for (const mesh of bodySkinnedMeshes) {
      const origSkeleton = mesh.skeleton;
      const origBones = origSkeleton.bones;
      const origBindMatrix = mesh.bindMatrix.clone();
      const origBindMatrixInverse = mesh.bindMatrixInverse.clone();
      const newBones: THREE.Bone[] = [];
      const oldToNew = new Map<number, number>();

      for (let i = 0; i < origBones.length; i++) {
        const bone = origBones[i];
        if (essentialBones.has(bone)) {
          oldToNew.set(i, newBones.length);
          newBones.push(bone);
        }
      }

      const geo = mesh.geometry;
      const skinIndexAttr = geo.getAttribute('skinIndex') as THREE.BufferAttribute | undefined;
      const skinWeightAttr = geo.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;
      if (!skinIndexAttr || !skinWeightAttr) continue;

      const oldIndices = skinIndexAttr.array;
      const weights = skinWeightAttr.array;
      const newIndices = new Uint16Array(oldIndices.length);

      for (let i = 0; i < oldIndices.length; i++) {
        newIndices[i] = weights[i] > 0.0001 ? oldToNew.get(oldIndices[i]) ?? 0 : 0;
      }

      /* Inverses come from the REST pose, never from the live pose: a
         skeleton built while the character is posed (or, worse, mid-
         animation) would make that frame the exported rest. */
      const pruned = new THREE.Skeleton(newBones, restInverses(newBones, origSkeleton));
      restoreMeshSkeletons.push(() => {
        skinIndexAttr.array = oldIndices;
        skinIndexAttr.needsUpdate = true;
        /* Restore the exact original binding rather than re-deriving it:
           `bind(origSkeleton, identity)` would drop the mesh's real bind
           matrix and let `bindMatrixInverse` pick up the current pose. */
        mesh.bind(origSkeleton, origBindMatrix);
        mesh.bindMatrixInverse.copy(origBindMatrixInverse);
        pruned.dispose();
      });
      skinIndexAttr.array = newIndices;
      skinIndexAttr.needsUpdate = true;
      mesh.bind(pruned, new THREE.Matrix4());
    }

    // 3. Hide the separate SkyrimHeadRoot and attach its facial meshes to the
    //    unified skeleton, recording the root's ORIGINAL visibility.
    if (headRoot) {
      /* Facial meshes are still rebuilt and added when the root was already
         hidden — only the visibility change itself is conditional, so the
         facial geometry never silently vanishes from an export. */
      if (headRoot.visible) hide(headRoot);
      headRoot.traverse((child) => {
        if ((child as any).isMesh && child.name && child.name !== 'SkyrimHeadRoot') {
          const mesh = child as THREE.Mesh;
          const semanticName =
            mesh.name === 'FemaleHead_hph' || mesh.name === 'Head' ? 'Face' : mesh.name;
          const tempMesh = createHeadSkinnedMesh(
            mesh,
            semanticName,
            rootBone!,
            headBone,
            restHeadWorld,
          );
          tempFacialMeshes.push(tempMesh);
          character.add(tempMesh);
        }
      });
    }

    // 4. Hide UI gizmos, overlay lines, and helper meshes.
    character.traverse((child) => {
      if (
        child.name === 'face-gizmo' ||
        child.name === 'mesh-overlay' ||
        (child as any).isTransformControls ||
        (child as any).isLine ||
        (child as any).isLineSegments ||
        (child as any).isPoints ||
        child.userData?.isHelper
      ) {
        if (child.visible) hide(child);
      }
    });

    // 4.5. Sanitize materials on all meshes for clean standard PBR glTF export.
    // Replaces physical materials (carrying clearcoat & sheen) and materials with
    // roughnessMap (which triggers three-stdlib's bug baking metallic=1.0 into the blue channel)
    // with clean MeshStandardMaterials having metallic: 0.0, natural roughness, and proper maps.
    character.traverse((child) => {
      if ((child as any).isMesh) {
        const mesh = child as THREE.Mesh;
        if (!mesh.material) return;

        const origMat = mesh.material;
        restoreMaterials.push({ mesh, origMaterial: origMat });

        const sanitize = (m: THREE.Material): THREE.Material => {
          if (!(m as any).isMeshStandardMaterial && !(m as any).isMeshPhysicalMaterial) return m;
          const std = m as THREE.MeshStandardMaterial;
          const matName = std.name || mesh.name || '';
          const { lower, isLashesOrBrows, isSkin, isEyes, isHair, isGarment } = classifyExportMaterial(matName, {
            alphaMasked: Boolean(std.transparent || std.alphaTest > 0),
          });
          const fabric = isGarment ? detectFabricProfile(matName) : null;
          const defaultR = isEyes
            ? 0.04
            : isSkin
            ? 0.55
            : isHair
            ? 0.62
            : isLashesOrBrows
            ? 0.72
            : fabric?.roughness ?? std.roughness ?? 0.55;
          const defaultM = isSkin || isHair || isEyes || isLashesOrBrows
            ? 0.0
            : fabric?.metalness ?? std.metalness ?? 0.0;

          // If roughnessMap or metalnessMap is present, bake them into the canonical glTF
          // combined metallicRoughness texture (Green = Roughness, Blue = Metalness).
          // Setting both roughnessMap and metalnessMap to this packed canvas avoids three-stdlib's
          // buildMetalRoughTexture bug (which filled missing blue channels with #00ffff / 100% metalness),
          // while ensuring Blender connects the Green channel to Roughness and keeps skin non-metallic.
          const packedMetalRough = buildPackedMetalRoughnessTexture(
            std.roughnessMap,
            std.metalnessMap,
            defaultR,
            defaultM,
          );
          if (packedMetalRough && packedMetalRough !== std.roughnessMap && packedMetalRough !== std.metalnessMap) {
            tempTextures.push(packedMetalRough);
          }

          // Bake color tint directly into diffuse texture pixels in sRGB space for ALL tinted
          // textured parts (hair, hairline underlay, white-RGB brows, lashes, skin tone).
          // That keeps baseColorFactor = [1, 1, 1, a] while carrying exact colors cleanly to Blender.
          let finalMap = std.map ?? null;
          if (finalMap && std.color && (std.color.r < 0.995 || std.color.g < 0.995 || std.color.b < 0.995)) {
            const baked = buildTintedDiffuseTexture(finalMap, std.color);
            if (baked !== finalMap) {
              finalMap = baked;
              tempTextures.push(baked);
            }
          }

          // Semantic texture names so GLTFExporter and Blender show clean labels matching PBR standards
          const baseName = cleanPbrPartName(matName || mesh.name || '');
          if (finalMap) finalMap.name = `${baseName}_basecolor`;
          if (std.normalMap) std.normalMap.name = `${baseName}_normal`;
          if (packedMetalRough) packedMetalRough.name = `${baseName}_roughness`;

          // Hair and lashes/brows MUST use alphaTest with transparent=false so glTF exports alphaMode="MASK"
          // (transparent=true forces alphaMode="BLEND" which causes Blender EEVEE alpha sorting failure / ghost hair).
          const needsAlphaMask = isHair || isLashesOrBrows;

          // When a texture map is present, tint was baked above so material.color stays pure white [1, 1, 1],
          // ensuring GLTFExporter never emits a dark multiplicative baseColorFactor.
          const exportColor = finalMap
            ? new THREE.Color(1, 1, 1)
            : std.color
            ? std.color.clone()
            : new THREE.Color(1, 1, 1);

          // Hair cards ship without TANGENT vertex attributes; moderate normal scale avoids foil glare in Blender.
          const normalScale = std.normalScale ? std.normalScale.clone() : new THREE.Vector2(1, 1);
          if (isHair && std.normalMap) {
            normalScale.set(Math.min(0.35, Math.abs(normalScale.x)), Math.min(0.35, Math.abs(normalScale.y)));
          }

          return new THREE.MeshStandardMaterial({
            name: std.name || mesh.name,
            color: exportColor,
            map: finalMap,
            normalMap: std.normalMap ?? null,
            normalScale,
            roughness: packedMetalRough ? 1.0 : defaultR,
            metalness: defaultM,
            roughnessMap: packedMetalRough ?? null,
            metalnessMap: packedMetalRough ?? null,
            transparent: false,
            opacity: std.opacity ?? 1.0,
            alphaTest: isHair ? 0.35 : (lower.includes('brow') ? 0.18 : (isLashesOrBrows ? 0.25 : 0)),
            side: needsAlphaMask ? THREE.DoubleSide : std.side,
            visible: std.visible, // CRITICAL: preserve hidden status to prevent white untextured embedded body meshes
          });
        };

        if (Array.isArray(origMat)) {
          if (origMat.length === 1 && (!mesh.geometry.groups || mesh.geometry.groups.length === 0)) {
            mesh.material = sanitize(origMat[0]);
          } else {
            mesh.material = origMat.map((m) => sanitize(m));
            // Filter geometry.groups so GLTFExporter omits primitives whose material is invisible (e.g. embedded body in clothing)
            if (mesh.geometry.groups && mesh.geometry.groups.length > 0) {
              const origGroups = [...mesh.geometry.groups];
              restoreGroups.push({ mesh, origGroups });
              mesh.geometry.groups = origGroups.filter((g) => {
                const matIdx = g.materialIndex ?? 0;
                const mat = origMat[matIdx];
                return mat ? mat.visible !== false : true;
              });
            }
          }
        } else {
          mesh.material = sanitize(origMat);
        }
      }
    });

    // 5. Prepare safe export name and compute ground elevation (feet soles at Y = 0.0).
    // Note: We do NOT mutate character.position or character.rotation in the live scene!
    // Mutating live scene transforms during export caused the viewport to elevate +1.55m
    // and face backwards, snapping the user's camera to the feet during the async export.
    // Instead, elevation and 180° rotation are cleanly injected into the GLB root node via patchGlbIor.
    const rawName = customName || 'Character';
    const safeName = rawName.trim().replace(/[^a-zA-Z0-9_\-]/g, '_') || 'Character';
    character.name = safeName;

    const groundOffset = computeGroundOffset(character);

    /* 6. Build the clips the exporter will emit. Only the active pose is
       snapshotted (never all 72 tracks), and every track is filtered to the
       bones that survived pruning — the exporter warns and drops any track
       whose node is gone. Facial-rig (`SkyrimHeadRoot`) bones collapse onto
       the head bone below, so only body/XP32 motion is exported. */
    const keep = new Set(essentialList.flatMap((bone) => [bone.uuid, bone.name]));
    const animated = options?.animated !== false;
    const clips = animated ? buildExportClips(essentialList, keep) : [];

    const exporter = new GLTFExporter();
    const gltf = await exporter.parseAsync(character, {
      binary: true,
      trs: true,
      onlyVisible: true,
      animations: clips,
      maxTextureSize: 4096,
    });

    const blob = new Blob(
      [
        patchGlbIor(gltf as ArrayBuffer, {
          translation: [0, groundOffset, 0],
          rotation: [0, 1, 0, 0],
          rootName: safeName,
        }),
      ],
      { type: 'model/gltf-binary' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}.glb`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } finally {
    // Guaranteed restoration of live scene transforms
    character.position.copy(origPos);
    character.rotation.copy(origRot);
    character.name = origName;
    character.updateMatrixWorld(true);
    // Cleanup is itself failure-tolerant: one bad restore must not leave the
    // rest un-undone, so each step is isolated.
    for (const { mesh, origMaterial } of restoreMaterials) {
      mesh.material = origMaterial;
    }
    for (const { mesh, origGroups } of restoreGroups) {
      mesh.geometry.groups = origGroups;
    }
    for (const restore of restoreMeshSkeletons) {
      try {
        restore();
      } catch {
        /* keep restoring the remaining meshes */
      }
    }
    for (const tempMesh of tempFacialMeshes) {
      try {
        character.remove(tempMesh);
        tempMesh.geometry.dispose();
      } catch {
        /* keep cleaning up */
      }
    }
    for (const { object, wasVisible } of hidden) {
      object.visible = wasVisible;
    }
    for (const tex of tempTextures) {
      try {
        tex.dispose();
      } catch {}
    }
    packedTextureCache.clear();
    exportInFlight = false;
  }
}

/**
 * Mounts inside the Three.js Canvas to bridge between the scene graph
 * and external HUD export triggers.
 */
export function GlbExportBridge() {
  const { scene } = useThree();
  const name = useCharacter((s) => s.name);

  useEffect(() => {
    const handler = (customName?: string, options?: ExportOptions) =>
      exportCharacterScene(scene as THREE.Scene, customName || name, options);

    registerExportHandler(handler);
    return () => {
      unregisterExportHandler();
    };
  }, [scene, name]);

  return null;
}
