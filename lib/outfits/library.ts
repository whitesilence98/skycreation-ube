import type { LibraryResult } from '@/lib/presets/library';
import {
  findOutfitLabelCollision, isOutfitLibraryFull, normalizeOutfitRecord, sortOutfitRecords,
  type OutfitSetRecord,
} from '@/lib/outfits/records';

export type { LibraryResult } from '@/lib/presets/library';
export const OUTFIT_LIBRARY_DB = 'lyra-outfit-library';
export const OUTFIT_LIBRARY_STORE = 'outfits';
const UNAVAILABLE: LibraryResult<never> = {
  ok: false, reason: 'unavailable', message: 'Outfit sets unavailable — browser storage is blocked.',
};

function failure(error: unknown, fallback: string): LibraryResult<never> {
  const err = error as { name?: string; code?: number; message?: string } | null;
  return {
    ok: false,
    reason: err?.name === 'QuotaExceededError' || err?.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err?.code === 22 ? 'quota' : 'error',
    message: typeof err?.message === 'string' && err.message ? err.message : fallback,
  };
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (db: IDBDatabase | null) => {
      if (settled) { try { db?.close(); } catch {} return; }
      settled = true;
      clearTimeout(timer);
      resolve(db);
    };
    const timer = setTimeout(() => finish(null), 2000);
    try {
      if (typeof window === 'undefined' || !window.indexedDB) { finish(null); return; }
      const req = window.indexedDB.open(OUTFIT_LIBRARY_DB, 1);
      req.onupgradeneeded = () => {
        if (settled) { try { req.transaction?.abort(); } catch {} try { req.result.close(); } catch {} return; }
        try {
          if (!req.result.objectStoreNames.contains(OUTFIT_LIBRARY_STORE)) {
            req.result.createObjectStore(OUTFIT_LIBRARY_STORE, { keyPath: 'id' });
          }
        } catch { try { req.transaction?.abort(); } catch {} finish(null); }
      };
      req.onsuccess = () => {
        req.result.onversionchange = () => { try { req.result.close(); } catch {} };
        finish(req.result);
      };
      req.onerror = req.onblocked = () => finish(null);
    } catch { finish(null); }
  });
}

/** The only success boundary is transaction completion, including writes/deletes. */
async function transact<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore, accept: (value: T) => void, reject: (message: string, error?: unknown) => void) => void,
): Promise<LibraryResult<T>> {
  const db = await openDb();
  if (!db) return UNAVAILABLE;
  return new Promise((resolve) => {
    let value: T;
    let accepted = false;
    let outcome: LibraryResult<never> | undefined;
    let settled = false;
    let tx: IDBTransaction;
    const finish = (committed: boolean) => {
      if (settled) return;
      settled = true;
      try { db.close(); } catch {}
      resolve(outcome ?? (committed && accepted ? { ok: true, value } : failure(null, 'The outfit operation was not completed.')));
    };
    const captureError = (error: unknown) => {
      const next = failure(error, 'The outfit operation failed.');
      if (!outcome || (!next.ok && next.reason === 'quota')) outcome = next;
    };
    try {
      tx = db.transaction(OUTFIT_LIBRARY_STORE, mode);
      tx.oncomplete = () => finish(true);
      tx.onerror = (event) => captureError(tx.error ?? (event.target as IDBRequest | null)?.error);
      tx.onabort = () => { captureError(tx.error); finish(false); };
      work(tx.objectStore(OUTFIT_LIBRARY_STORE), (result) => { value = result; accepted = true; }, (message, error) => {
        outcome = failure(error, message);
        tx.abort();
      });
    } catch (error) {
      captureError(error);
      try { tx!.abort(); } catch {}
      finish(false);
    }
  });
}

function normalizedRows(raw: unknown): OutfitSetRecord[] {
  return (Array.isArray(raw) ? raw : []).map(normalizeOutfitRecord)
    .filter((row): row is OutfitSetRecord => row !== null);
}

export function listOutfitRecords(): Promise<LibraryResult<OutfitSetRecord[]>> {
  return transact('readonly', (store, accept) => {
    const req = store.getAll();
    req.onsuccess = () => accept(sortOutfitRecords(normalizedRows(req.result)));
  });
}

export function saveOutfitRecord(input: OutfitSetRecord): Promise<LibraryResult<OutfitSetRecord>> {
  const record = normalizeOutfitRecord(input);
  if (!record) return Promise.resolve({ ok: false, reason: 'error', message: 'That saved outfit is not valid.' });
  return transact('readwrite', (store, accept, reject) => {
    const req = store.getAll();
    req.onsuccess = () => {
      try {
        const existing = normalizedRows(req.result);
        const collision = findOutfitLabelCollision(existing, record.label, record.id);
        if (collision) { reject(`An outfit named "${collision.label}" already exists.`); return; }
        if (isOutfitLibraryFull(existing, record.id)) { reject('Outfit library is full — delete a set before saving another.'); return; }
        const current = existing.find((row) => row.id === record.id);
        const written = current ? { ...record, createdAt: current.createdAt } : record;
        store.put(written);
        accept(written);
      } catch (error) {
        reject('The outfit was not saved.', error);
      }
    };
  });
}

export function deleteOutfitRecord(id: string): Promise<LibraryResult<true>> {
  if (typeof id !== 'string' || !id.trim() || id.length > 128 || /[\p{Cc}\p{Cf}]/u.test(id)) {
    return Promise.resolve({ ok: false, reason: 'error', message: 'No valid outfit was named for deletion.' });
  }
  return transact('readwrite', (store, accept) => { store.delete(id); accept(true); });
}
