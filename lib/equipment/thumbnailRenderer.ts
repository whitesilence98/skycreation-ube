import * as THREE from 'three';
import type { MeshData, MeshGroup, MeshMaterialSpec } from '@/components/scene/useMeshGeometry';
import { meshDataToGeometry } from '@/components/scene/useMeshGeometry';

// In-memory cache for rendered 3D thumbnail WebP data URLs
const THUMBNAIL_CACHE = new Map<string, string>();
const PENDING_RENDERS = new Map<string, Promise<string | null>>();
const FAILED_RENDERS = new Set<string>();

interface RenderQueueItem {
  id: string;
  meshData: MeshData;
  resolve: (url: string | null) => void;
}

const renderQueue: RenderQueueItem[] = [];
let isProcessingQueue = false;

// Network fetch queue: limit concurrent downloads to avoid saturating HTTP sockets
const MAX_CONCURRENT_FETCHES = 2;
let activeFetches = 0;
const fetchQueue: Array<() => void> = [];

function enqueueFetch<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      activeFetches++;
      fn()
        .then(resolve, reject)
        .finally(() => {
          activeFetches--;
          const next = fetchQueue.shift();
          if (next) next();
        });
    };

    if (activeFetches < MAX_CONCURRENT_FETCHES) {
      run();
    } else {
      fetchQueue.push(run);
    }
  });
}

// Headless offscreen studio state (initialized lazily in browser)
let offscreenRenderer: THREE.WebGLRenderer | null = null;
let offscreenScene: THREE.Scene | null = null;
let offscreenCamera: THREE.PerspectiveCamera | null = null;
let offscreenCanvas: HTMLCanvasElement | null = null;
const textureCache = new Map<string, THREE.Texture>();
const failedTextures = new Set<string>();

const THUMB_WIDTH = 160;
const THUMB_HEIGHT = 120;

function initStudio(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }
  if (offscreenRenderer && offscreenScene && offscreenCamera) {
    return true;
  }

  try {
    offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = THUMB_WIDTH;
    offscreenCanvas.height = THUMB_HEIGHT;

    offscreenRenderer = new THREE.WebGLRenderer({
      canvas: offscreenCanvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'low-power',
    });

    offscreenRenderer.outputColorSpace = THREE.SRGBColorSpace;
    offscreenRenderer.setClearColor(0x000000, 0);
    offscreenRenderer.setSize(THUMB_WIDTH, THUMB_HEIGHT, false);

    offscreenScene = new THREE.Scene();

    // Studio 3-point lighting setup
    const ambient = new THREE.AmbientLight(0xffffff, 1.4);
    offscreenScene.add(ambient);

    // Warm Key Light (top-front-right)
    const keyLight = new THREE.DirectionalLight(0xfff5e6, 2.4);
    keyLight.position.set(1.8, 2.2, 2.4);
    offscreenScene.add(keyLight);

    // Cool Fill Light (left)
    const fillLight = new THREE.DirectionalLight(0xb4d8ff, 1.2);
    fillLight.position.set(-2.0, 0.6, 1.2);
    offscreenScene.add(fillLight);

    // Rim Backlight (enhances silhouettes and fabric edges)
    const rimLight = new THREE.DirectionalLight(0xffedd4, 1.8);
    rimLight.position.set(0, 2.2, -2.6);
    offscreenScene.add(rimLight);

    offscreenCamera = new THREE.PerspectiveCamera(36, THUMB_WIDTH / THUMB_HEIGHT, 0.01, 100);

    return true;
  } catch (err) {
    console.warn('[thumbnailRenderer] Could not initialize offscreen WebGL studio:', err);
    return false;
  }
}

/** Preload a texture with timeout so thumbnails render swiftly */
function loadTextureWithTimeout(url: string, timeoutMs = 800): Promise<THREE.Texture | null> {
  if (failedTextures.has(url)) return Promise.resolve(null);
  const cached = textureCache.get(url);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        failedTextures.add(url);
        resolve(null);
      }
    }, timeoutMs);

    new THREE.TextureLoader().load(
      url,
      (tex) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = true;
        textureCache.set(url, tex);
        resolve(tex);
      },
      undefined,
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        failedTextures.add(url);
        resolve(null);
      },
    );
  });
}

/**
 * For composite outfits that bake the character's body mesh (BaseShape, role === 'skin')
 * directly into the NIF alongside clothing, isolate the clothing geometry so that:
 * 1. The preview displays only the garment itself consistently.
 * 2. Heavy 170k+ vertex skin buffers are not uploaded to WebGL.
 * 3. Skin diffuse/normal textures are never downloaded for thumbnails.
 * 4. Auto-framing centers and zooms directly on the garment.
 */
export function extractGarmentMeshData(data: MeshData): MeshData {
  if (!data.groups || !data.materials || data.groups.length <= 1) {
    return data;
  }
  const hasSkin = data.materials.some((m) => m.role === 'skin');
  const hasNonSkin = data.materials.some((m) => m.role !== 'skin');
  if (!hasSkin || !hasNonSkin) {
    return data;
  }

  // Find non-skin groups
  const nonSkinGroups = data.groups.filter((g) => {
    const mat = data.materials?.[g.materialIndex];
    return mat && mat.role !== 'skin';
  });

  if (nonSkinGroups.length === 0) {
    return data;
  }

  // Remap materials
  const newMaterials: MeshMaterialSpec[] = [];
  const matIndexMap = new Map<number, number>();

  for (const g of nonSkinGroups) {
    if (!matIndexMap.has(g.materialIndex)) {
      const origMat = data.materials[g.materialIndex];
      matIndexMap.set(g.materialIndex, newMaterials.length);
      newMaterials.push(origMat);
    }
  }

  // Collect used vertex indices & remap them to prune unused skin vertices
  const oldToNewVert = new Map<number, number>();
  const newPositions: number[] = [];
  const newNormals: number[] = [];
  const newUvs: number[] = [];
  const origPos = data.positions;
  const origNorm = data.normals;
  const origUvs = data.uvs;

  const remapVertex = (oldIdx: number): number => {
    let newIdx = oldToNewVert.get(oldIdx);
    if (newIdx !== undefined) return newIdx;

    newIdx = oldToNewVert.size;
    oldToNewVert.set(oldIdx, newIdx);

    const p3 = oldIdx * 3;
    newPositions.push(origPos[p3], origPos[p3 + 1], origPos[p3 + 2]);
    newNormals.push(origNorm[p3], origNorm[p3 + 1], origNorm[p3 + 2]);

    const u2 = oldIdx * 2;
    newUvs.push(origUvs[u2], origUvs[u2 + 1]);

    return newIdx;
  };

  const newIndices: number[] = [];
  const newGroups: MeshGroup[] = [];
  let currentStart = 0;

  for (const g of nonSkinGroups) {
    const slice = data.indices.slice(g.start, g.start + g.count);
    for (let i = 0; i < slice.length; i++) {
      newIndices.push(remapVertex(slice[i]));
    }
    newGroups.push({
      start: currentStart,
      count: g.count,
      materialIndex: matIndexMap.get(g.materialIndex)!,
    });
    currentStart += g.count;
  }

  return {
    positions: new Float32Array(newPositions),
    normals: new Float32Array(newNormals),
    uvs: new Float32Array(newUvs),
    indices: newIndices,
    groups: newGroups,
    materials: newMaterials,
  };
}

/** Render a single clothing mesh data object to a WebP data URL */
async function renderMeshDataToDataUrl(meshData: MeshData): Promise<string | null> {
  if (!initStudio() || !offscreenRenderer || !offscreenScene || !offscreenCamera) {
    return null;
  }

  let loadedMesh;
  try {
    loadedMesh = meshDataToGeometry(meshData);
  } catch {
    return null;
  }

  const { geometry, materials: matSpecs, groups } = loadedMesh;

  // Auto-frame geometry: compute bounds & center
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const sphere = geometry.boundingSphere;
  if (!sphere || !Number.isFinite(sphere.radius) || sphere.radius <= 0) {
    geometry.dispose();
    return null;
  }

  const radius = Math.max(sphere.radius, 0.04);
  const center = sphere.center;

  // Resolve textures for material slots
  const threeMaterials: THREE.Material[] = [];
  if (matSpecs && matSpecs.length > 0) {
    for (const spec of matSpecs) {
      let tex: THREE.Texture | null = null;
      if (spec.texture) {
        tex = await loadTextureWithTimeout(spec.texture);
      }
      threeMaterials.push(
        new THREE.MeshStandardMaterial({
          map: tex,
          color: tex ? 0xffffff : 0xb5a894,
          roughness: 0.55,
          metalness: 0.1,
          alphaTest: spec.alphaTest ?? (tex ? 0.05 : 0),
          side: THREE.DoubleSide,
        }),
      );
    }
  } else {
    threeMaterials.push(
      new THREE.MeshStandardMaterial({
        color: 0xbaa992,
        roughness: 0.55,
        metalness: 0.1,
        side: THREE.DoubleSide,
      }),
    );
  }

  // Build temporary mesh inside a centering pivot group
  const pivot = new THREE.Group();
  const mesh = new THREE.Mesh(
    geometry,
    threeMaterials.length === 1 ? threeMaterials[0] : threeMaterials,
  );
  mesh.position.set(-center.x, -center.y, -center.z);
  pivot.add(mesh);
  offscreenScene.add(pivot);

  // Position camera at flattering 3/4 studio angle
  const fovRad = (offscreenCamera.fov * Math.PI) / 180;
  const dist = (radius / Math.sin(fovRad / 2)) * 1.18;
  const yaw = (16 * Math.PI) / 180;
  const pitch = (10 * Math.PI) / 180;

  offscreenCamera.position.set(
    Math.sin(yaw) * Math.cos(pitch) * dist,
    Math.sin(pitch) * dist,
    Math.cos(yaw) * Math.cos(pitch) * dist,
  );
  offscreenCamera.lookAt(0, 0, 0);

  try {
    offscreenRenderer.render(offscreenScene, offscreenCamera);
    const dataUrl = offscreenRenderer.domElement.toDataURL('image/webp', 0.88);
    return dataUrl;
  } catch (err) {
    console.warn('[thumbnailRenderer] Render failed:', err);
    return null;
  } finally {
    // Clean up temporary scene node & materials
    offscreenScene.remove(pivot);
    for (const mat of threeMaterials) mat.dispose();
    geometry.dispose();
  }
}

async function processQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (renderQueue.length > 0) {
    const item = renderQueue.shift();
    if (!item) break;

    try {
      const url = await renderMeshDataToDataUrl(item.meshData);
      if (url) {
        THUMBNAIL_CACHE.set(item.id, url);
      }
      item.resolve(url);
    } catch {
      item.resolve(null);
    }

    // Yield to browser main thread so user scrolling and 3D viewport stay 60fps
    await new Promise<void>((resolve) => {
      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        (window as unknown as { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback(
          () => resolve(),
          { timeout: 16 },
        );
      } else {
        setTimeout(resolve, 8);
      }
    });
  }

  isProcessingQueue = false;
}

/** Check if a thumbnail is already rendered in memory */
export function getCachedGarmentThumbnail(id: string): string | undefined {
  return THUMBNAIL_CACHE.get(id);
}

/** Request an asynchronous 3D thumbnail snapshot for a given clothing mesh */
export function requestGarmentThumbnail(
  id: string,
  meshUrl: string,
): Promise<string | null> {
  const cached = THUMBNAIL_CACHE.get(id);
  if (cached) return Promise.resolve(cached);

  if (FAILED_RENDERS.has(id)) return Promise.resolve(null);

  const pending = PENDING_RENDERS.get(id);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const data = await enqueueFetch(async () => {
        const res = await fetch(meshUrl);
        if (!res.ok) return null;
        return (await res.json()) as MeshData;
      });

      if (!data || !data.positions) {
        FAILED_RENDERS.add(id);
        return null;
      }

      // Filter out heavy embedded skin meshes (BaseShape)
      const garmentData = extractGarmentMeshData(data);

      return new Promise<string | null>((resolve) => {
        renderQueue.push({
          id,
          meshData: garmentData,
          resolve: (url) => {
            if (!url) FAILED_RENDERS.add(id);
            resolve(url);
          },
        });
        void processQueue();
      });
    } catch {
      FAILED_RENDERS.add(id);
      return null;
    } finally {
      PENDING_RENDERS.delete(id);
    }
  })();

  PENDING_RENDERS.set(id, promise);
  return promise;
}
