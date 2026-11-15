import * as THREE from 'three';
import type { MeshData } from '@/components/scene/useMeshGeometry';
import { meshDataToGeometry } from '@/components/scene/useMeshGeometry';

// In-memory cache for rendered 3D thumbnail WebP data URLs
const THUMBNAIL_CACHE = new Map<string, string>();
const PENDING_RENDERS = new Map<string, Promise<string | null>>();

interface RenderQueueItem {
  id: string;
  meshData: MeshData;
  resolve: (url: string | null) => void;
}

const renderQueue: RenderQueueItem[] = [];
let isProcessingQueue = false;

// Headless offscreen studio state (initialized lazily in browser)
let offscreenRenderer: THREE.WebGLRenderer | null = null;
let offscreenScene: THREE.Scene | null = null;
let offscreenCamera: THREE.PerspectiveCamera | null = null;
let offscreenCanvas: HTMLCanvasElement | null = null;
const textureCache = new Map<string, THREE.Texture>();

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
  const cached = textureCache.get(url);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
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
        resolve(null);
      },
    );
  });
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

    // Yield tiny 4ms slice to keep UI 60fps responsive
    await new Promise((r) => setTimeout(r, 4));
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

  const pending = PENDING_RENDERS.get(id);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const res = await fetch(meshUrl);
      if (!res.ok) return null;
      const data = (await res.json()) as MeshData;
      if (!data || !data.positions) return null;

      return new Promise<string | null>((resolve) => {
        renderQueue.push({ id, meshData: data, resolve });
        void processQueue();
      });
    } catch {
      return null;
    } finally {
      PENDING_RENDERS.delete(id);
    }
  })();

  PENDING_RENDERS.set(id, promise);
  return promise;
}
