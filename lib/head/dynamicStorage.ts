import type { MeshData } from '@/components/scene/useMeshGeometry';
import type { Mo2MeshOption } from '@/lib/head/faceTexture';

const DB_NAME = 'lyra-dynamic-mesh-store';
const DB_VERSION = 1;
const STORE_NAME = 'meshes';
const HEAD_OPTIONS_KEY = 'lyra.dynamic-head-options';

function openDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !window.indexedDB) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Save mesh data to IndexedDB so it survives page reloads (F5). */
export async function persistDynamicMesh(url: string, data: MeshData): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const storable = {
        positions: Array.isArray(data.positions) ? data.positions : Array.from(data.positions),
        normals: Array.isArray(data.normals) ? data.normals : Array.from(data.normals),
        uvs: Array.isArray(data.uvs) ? data.uvs : Array.from(data.uvs),
        indices: Array.isArray(data.indices) ? data.indices : Array.from(data.indices),
      };
      store.put(storable, url);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Retrieve mesh data from IndexedDB. */
export async function retrieveDynamicMesh(url: string): Promise<MeshData | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(url);
      req.onsuccess = () => {
        const res = req.result;
        if (!res || !res.positions) {
          resolve(undefined);
          return;
        }
        resolve({
          positions: new Float32Array(res.positions),
          normals: new Float32Array(res.normals),
          uvs: new Float32Array(res.uvs),
          indices: Array.isArray(res.indices) ? res.indices : Array.from(res.indices),
        });
      };
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

/** Retrieve all cached dynamic meshes into a map for warm startup. */
export async function retrieveAllDynamicMeshes(): Promise<Map<string, MeshData>> {
  const map = new Map<string, MeshData>();
  const db = await openDb();
  if (!db) return map;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          const url = cursor.key as string;
          const val = cursor.value;
          if (val && val.positions) {
            map.set(url, {
              positions: new Float32Array(val.positions),
              normals: new Float32Array(val.normals),
              uvs: new Float32Array(val.uvs),
              indices: Array.isArray(val.indices) ? val.indices : Array.from(val.indices),
            });
          }
          cursor.continue();
        } else {
          resolve(map);
        }
      };
      cursorReq.onerror = () => resolve(map);
    } catch {
      resolve(map);
    }
  });
}

/** Read dynamic head options from localStorage. */
export function loadPersistedHeadOptions(): Mo2MeshOption[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HEAD_OPTIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** Save dynamic head options to localStorage. */
export function savePersistedHeadOptions(options: Mo2MeshOption[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(HEAD_OPTIONS_KEY, JSON.stringify(options));
  } catch {}
}
