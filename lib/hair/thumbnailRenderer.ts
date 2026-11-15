import * as THREE from 'three';
import type { MeshData, MeshMaterialSpec } from '@/components/scene/useMeshGeometry';
import { meshDataToGeometry } from '@/components/scene/useMeshGeometry';

// In-memory cache for rendered 3D hair thumbnail WebP data URLs
const HAIR_THUMBNAIL_CACHE = new Map<string, string>();
const PENDING_RENDERS = new Map<string, Promise<string | null>>();
const FAILED_RENDERS = new Set<string>();

interface HairRenderItem {
  id: string;
  meshDataList: MeshData[];
  hairTone?: string;
  resolve: (url: string | null) => void;
}

const renderQueue: HairRenderItem[] = [];
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

// Headless offscreen salon studio state (initialized lazily in browser)
let offscreenRenderer: THREE.WebGLRenderer | null = null;
let offscreenScene: THREE.Scene | null = null;
let offscreenCamera: THREE.PerspectiveCamera | null = null;
let offscreenCanvas: HTMLCanvasElement | null = null;
const textureCache = new Map<string, THREE.Texture>();
const failedTextures = new Set<string>();

const THUMB_SIZE = 160;

function initSalonStudio(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }
  if (offscreenRenderer && offscreenScene && offscreenCamera) {
    return true;
  }

  try {
    offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = THUMB_SIZE;
    offscreenCanvas.height = THUMB_SIZE;

    offscreenRenderer = new THREE.WebGLRenderer({
      canvas: offscreenCanvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'low-power',
    });

    offscreenRenderer.outputColorSpace = THREE.SRGBColorSpace;
    offscreenRenderer.setClearColor(0x000000, 0);
    offscreenRenderer.setSize(THUMB_SIZE, THUMB_SIZE, false);

    offscreenScene = new THREE.Scene();

    // Studio lighting setup optimized for hair strands and anisotropic sheen
    const ambient = new THREE.AmbientLight(0xffffff, 1.2);
    offscreenScene.add(ambient);

    // Warm Key Light (front-top-right)
    const keyLight = new THREE.DirectionalLight(0xfff2e0, 2.4);
    keyLight.position.set(1.6, 2.2, 2.0);
    offscreenScene.add(keyLight);

    // Cool Fill Light (left)
    const fillLight = new THREE.DirectionalLight(0xb8dcff, 1.2);
    fillLight.position.set(-2.0, 0.8, 1.2);
    offscreenScene.add(fillLight);

    // High-Intensity Rim Backlight (behind-top to capture strand silhouettes & alpha cutouts)
    const rimLight = new THREE.DirectionalLight(0xfff0dd, 2.8);
    rimLight.position.set(0, 2.2, -2.6);
    offscreenScene.add(rimLight);

    // Subtle Under-Fill Light (softens chin/neck shadow)
    const underLight = new THREE.DirectionalLight(0xffffff, 0.5);
    underLight.position.set(0, -0.6, 1.8);
    offscreenScene.add(underLight);

    offscreenCamera = new THREE.PerspectiveCamera(35, 1.0, 0.01, 100);

    return true;
  } catch (err) {
    console.warn('[hairThumbnailRenderer] Could not initialize offscreen salon studio:', err);
    return false;
  }
}

/** Preload a hair texture with timeout so thumbnails render swiftly */
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

/** Create a sleek, matte dark mannequin cranium to give hair strands realistic head context */
function createMannequinHead(): THREE.Mesh {
  const craniumGeo = new THREE.SphereGeometry(0.076, 32, 24);
  craniumGeo.scale(0.85, 1.15, 0.98);
  const craniumMat = new THREE.MeshStandardMaterial({
    color: 0x141312,
    roughness: 0.9,
    metalness: 0.1,
  });
  const mesh = new THREE.Mesh(craniumGeo, craniumMat);
  mesh.position.set(0, 0.045, -0.010);
  return mesh;
}

/** Render one or more hair mesh data objects into a composite 3D WebP data URL */
async function renderHairMeshDataToDataUrl(
  meshDataList: MeshData[],
  hairTone?: string,
): Promise<string | null> {
  if (!initSalonStudio() || !offscreenRenderer || !offscreenScene || !offscreenCamera) {
    return null;
  }

  if (!meshDataList.length) return null;

  const pivot = new THREE.Group();
  const createdMeshes: THREE.Mesh[] = [];
  const createdGeometries: THREE.BufferGeometry[] = [];
  const createdMaterials: THREE.Material[] = [];

  // 1. Add sleek dark mannequin head inside the pivot
  const mannequin = createMannequinHead();
  pivot.add(mannequin);
  createdMeshes.push(mannequin);
  createdGeometries.push(mannequin.geometry);
  if (Array.isArray(mannequin.material)) {
    createdMaterials.push(...mannequin.material);
  } else {
    createdMaterials.push(mannequin.material);
  }

  // 2. Compute combined bounds across all hair parts
  const combinedBox = new THREE.Box3();

  for (const meshData of meshDataList) {
    let loadedMesh;
    try {
      loadedMesh = meshDataToGeometry(meshData);
    } catch {
      continue;
    }

    const { geometry, materials: matSpecs } = loadedMesh;
    createdGeometries.push(geometry);

    geometry.computeBoundingBox();
    if (geometry.boundingBox) {
      combinedBox.union(geometry.boundingBox);
    }

    // Resolve materials
    const threeMaterials: THREE.Material[] = [];
    const baseColorHex = hairTone ? parseInt(hairTone.replace('#', '0x'), 16) : 0xcda56b; // Salon Honey Wheat

    if (matSpecs && matSpecs.length > 0) {
      for (const spec of matSpecs) {
        let tex: THREE.Texture | null = null;
        if (spec.texture) {
          tex = await loadTextureWithTimeout(spec.texture);
        }

        const mat = new THREE.MeshStandardMaterial({
          map: tex,
          color: tex ? (hairTone ? baseColorHex : 0xffffff) : baseColorHex,
          roughness: 0.55,
          metalness: 0.12,
          alphaTest: spec.alphaTest ?? 0.16,
          side: THREE.DoubleSide,
          transparent: true,
        });

        threeMaterials.push(mat);
        createdMaterials.push(mat);
      }
    } else {
      const mat = new THREE.MeshStandardMaterial({
        color: baseColorHex,
        roughness: 0.55,
        metalness: 0.12,
        alphaTest: 0.16,
        side: THREE.DoubleSide,
        transparent: true,
      });
      threeMaterials.push(mat);
      createdMaterials.push(mat);
    }

    const mesh = new THREE.Mesh(
      geometry,
      threeMaterials.length === 1 ? threeMaterials[0] : threeMaterials,
    );
    mesh.castShadow = true;
    pivot.add(mesh);
    createdMeshes.push(mesh);
  }

  if (combinedBox.isEmpty()) {
    for (const g of createdGeometries) g.dispose();
    for (const m of createdMaterials) m.dispose();
    return null;
  }

  const sphere = new THREE.Sphere();
  combinedBox.getBoundingSphere(sphere);
  const radius = Math.max(sphere.radius, 0.08);
  const center = sphere.center;

  // Center hair and mannequin pivot at origin
  pivot.position.set(-center.x, -center.y, -center.z);
  offscreenScene.add(pivot);

  // Position camera at flattering 3/4 salon portrait angle (elevated to capture crown & bangs)
  const fovRad = (offscreenCamera.fov * Math.PI) / 180;
  const dist = Math.max((radius / Math.sin(fovRad / 2)) * 1.15, 0.38);
  const yaw = (22 * Math.PI) / 180;
  const pitch = (12 * Math.PI) / 180;

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
    console.warn('[hairThumbnailRenderer] Render failed:', err);
    return null;
  } finally {
    // Clean up temporary scene graph nodes and WebGL resources
    offscreenScene.remove(pivot);
    for (const g of createdGeometries) g.dispose();
    for (const m of createdMaterials) m.dispose();
  }
}

async function processHairQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (renderQueue.length > 0) {
    const item = renderQueue.shift();
    if (!item) break;

    try {
      const url = await renderHairMeshDataToDataUrl(item.meshDataList, item.hairTone);
      if (url) {
        HAIR_THUMBNAIL_CACHE.set(item.id, url);
      }
      item.resolve(url);
    } catch {
      item.resolve(null);
    }

    // Yield to browser main thread so scrolling and 3D viewport stay 60fps
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

/** Check if a hair thumbnail is already rendered in memory */
export function getCachedHairThumbnail(id: string): string | undefined {
  return HAIR_THUMBNAIL_CACHE.get(id);
}

/** Request an asynchronous 3D hairstyle snapshot for one or more hair mesh URLs */
export function requestHairThumbnail(
  id: string,
  meshUrls: string | string[],
  hairTone?: string,
): Promise<string | null> {
  const cached = HAIR_THUMBNAIL_CACHE.get(id);
  if (cached) return Promise.resolve(cached);

  if (FAILED_RENDERS.has(id)) return Promise.resolve(null);

  const pending = PENDING_RENDERS.get(id);
  if (pending) return pending;

  const urls = Array.isArray(meshUrls) ? meshUrls : [meshUrls];

  const promise = (async () => {
    try {
      const meshDataList: MeshData[] = [];

      for (const url of urls) {
        if (!url) continue;
        const data = await enqueueFetch(async () => {
          const res = await fetch(url);
          if (!res.ok) return null;
          return (await res.json()) as MeshData;
        });

        if (data && data.positions) {
          meshDataList.push(data);
        }
      }

      if (!meshDataList.length) {
        FAILED_RENDERS.add(id);
        return null;
      }

      return new Promise<string | null>((resolve) => {
        renderQueue.push({
          id,
          meshDataList,
          hairTone,
          resolve: (url) => {
            if (!url) FAILED_RENDERS.add(id);
            resolve(url);
          },
        });
        void processHairQueue();
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
