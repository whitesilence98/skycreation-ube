import {
  findLabelCollision,
  isAtCapacity,
  normalizeRecord,
  sortRecords,
  type PresetLibraryRecord,
} from '@/lib/presets/records';

/**
 * IndexedDB IO for the named preset library.
 *
 * The shape follows `lib/head/dynamicStorage.ts` — raw `window.indexedDB`,
 * Promise wrappers, nothing ever rejects — with two differences that matter
 * for a user-initiated save:
 *
 * - an open timeout, because a blocked upgrade (another tab holding v1 open)
 *   would otherwise leave the save button spinning forever; and
 * - the label-uniqueness and 50-record rules are enforced *inside* the
 *   readwrite transaction. The UI also pre-checks them for a friendly confirm,
 *   but two tabs saving at once must not both win.
 *
 * Every function returns a `LibraryResult`, never throws, and success resolves
 * on `tx.oncomplete` — an `onabort` is a failure even if a request's
 * `onsuccess` already fired.
 */

export type LibraryResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'unavailable' | 'quota' | 'error'; message?: string };

export const PRESET_LIBRARY_DB = 'lyra-preset-library';
export const PRESET_LIBRARY_STORE = 'presets';

const DB_VERSION = 1;

function indexedDbFactory(): IDBFactory | null {
  if (typeof window === 'undefined') return null;
  try { return window.indexedDB ?? null; } catch { return null; }
}

function describe(err: unknown): string | undefined {
  if (err && typeof err === 'object') {
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return undefined;
}

function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: unknown }).name;
  const code = (err as { code?: unknown }).code;
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22;
}

function failure(err: unknown, fallback: string): LibraryResult<never> {
  return {
    ok: false,
    reason: isQuotaError(err) ? 'quota' : 'error',
    message: describe(err) ?? fallback,
  };
}

const UNAVAILABLE: LibraryResult<never> = {
  ok: false,
  reason: 'unavailable',
  message: 'Preset library unavailable — browser storage is blocked.',
};

/**
 * Open the database, resolving `null` when it cannot be opened.
 *
 * A success that lands after the timeout, or a blocked event, is closed rather
 * than leaked: the caller has already been told the write did not happen, and
 * leaving a second connection open would make the next upgrade blocked too.
 * The timer is a real `setTimeout`; tests can supply a fake `window` whose
 * `indexedDB` never fires and let the timeout settle.
 */
function openDb(): Promise<IDBDatabase | null> {
  const idb = indexedDbFactory();
  if (!idb) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (value: IDBDatabase | null) => {
      if (settled) {
        if (value) {
          try {
            value.close();
          } catch {}
        }
        return;
      }
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(value);
    };
    timer = setTimeout(() => finish(null), 2000);
    try {
      const req = idb.open(PRESET_LIBRARY_DB, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        try {
          if (!db.objectStoreNames.contains(PRESET_LIBRARY_STORE)) {
            db.createObjectStore(PRESET_LIBRARY_STORE, { keyPath: 'id' });
          }
        } catch {}
      };
      req.onsuccess = () => finish(req.result);
      req.onerror = () => finish(null);
      req.onblocked = () => finish(null);
    } catch {
      finish(null);
    }
  });
}

export async function listPresetRecords(): Promise<LibraryResult<PresetLibraryRecord[]>> {
  const db = await openDb();
  if (!db) return UNAVAILABLE;
  return new Promise((resolve) => {
    let rows: PresetLibraryRecord[] = [];
    let failureResult: LibraryResult<PresetLibraryRecord[]> | null = null;
    const done = () => {
      try {
        db.close();
      } catch {}
      resolve(failureResult ?? { ok: true, value: rows });
    };
    try {
      const tx = db.transaction(PRESET_LIBRARY_STORE, 'readonly');
      const store = tx.objectStore(PRESET_LIBRARY_STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        const raw = Array.isArray(req.result) ? (req.result as unknown[]) : [];
        rows = sortRecords(
          raw
            .map((row) => normalizeRecord(row))
            .filter((row): row is PresetLibraryRecord => row !== null),
        );
      };
      req.onerror = () => {
        failureResult = failure(
          req.error,
          'Could not read the preset library.',
        ) as LibraryResult<PresetLibraryRecord[]>;
      };
      // Success is the transaction completing, not the request succeeding.
      tx.oncomplete = done;
      tx.onabort = () => {
        failureResult =
          failureResult ??
          (failure(tx.error, 'Reading the preset library was aborted.') as LibraryResult<
            PresetLibraryRecord[]
          >);
        done();
      };
      tx.onerror = () => {
        failureResult =
          failureResult ??
          (failure(tx.error, 'Could not read the preset library.') as LibraryResult<
            PresetLibraryRecord[]
          >);
      };
    } catch (err) {
      failureResult = failure(err, 'Could not read the preset library.') as LibraryResult<
        PresetLibraryRecord[]
      >;
      done();
    }
  });
}

/**
 * Create or replace a record.
 *
 * The record is re-validated here (the UI is not the trust boundary), then the
 * whole list is read *inside the same readwrite transaction* so the uniqueness
 * and capacity checks cannot race a second tab. A collision with a different
 * id, or a new save at 50 records, aborts the transaction and returns an error
 * result. An overwrite keeps the record's original `createdAt`.
 */
export async function savePresetRecord(
  input: PresetLibraryRecord,
): Promise<LibraryResult<PresetLibraryRecord>> {
  const record = normalizeRecord(input);
  if (!record) {
    return { ok: false, reason: 'error', message: 'That saved preset is not valid.' };
  }
  const db = await openDb();
  if (!db) return UNAVAILABLE;
  return new Promise((resolve) => {
    /* `failureOutcome` is set only for a decision the request already knows
       about (invalid, collision, full). The success result is *not* recorded
       when `put` is queued: in IndexedDB the write is not a save until the
       transaction commits, and a quota error surfaces as an abort after the
       request that caused it. Resolving early would report a save that the
       browser rolled back. */
    let failureOutcome: LibraryResult<PresetLibraryRecord> | null = null;
    let written: PresetLibraryRecord | null = null;
    let settled = false;
    /* `done` is shared by complete/abort; the successful value is produced
       here from `written` so an abort (which never runs oncomplete) cannot
       accidentally resolve as success. */
    const done = (committed: boolean) => {
      if (settled) return;
      settled = true;
      try {
        db.close();
      } catch {}
      if (failureOutcome) resolve(failureOutcome);
      else if (committed && written) resolve({ ok: true, value: written });
      else resolve({ ok: false, reason: 'error', message: 'The preset was not saved.' });
    };
    try {
      const tx = db.transaction(PRESET_LIBRARY_STORE, 'readwrite');
      const store = tx.objectStore(PRESET_LIBRARY_STORE);
      const all = store.getAll();
      all.onsuccess = () => {
        try {
          const raw = Array.isArray(all.result) ? (all.result as unknown[]) : [];
          const existing = raw
            .map((row) => normalizeRecord(row))
            .filter((row): row is PresetLibraryRecord => row !== null);
          const current = existing.find((row) => row.id === record.id);

          const collision = findLabelCollision(existing, record.label, record.id);
          if (collision) {
            failureOutcome = {
              ok: false,
              reason: 'error',
              message: `A preset named "${collision.label}" already exists.`,
            };
            tx.abort();
            return;
          }
          if (isAtCapacity(existing, current ? record.id : undefined)) {
            failureOutcome = {
              ok: false,
              reason: 'error',
              message: 'Preset library is full — delete a preset before saving another.',
            };
            tx.abort();
            return;
          }

          /* An overwrite keeps the original creation time; the label, look and
             thumbnail all move to the new version. */
          written = current ? { ...record, createdAt: current.createdAt } : record;
          store.put(written);
        } catch (err) {
          failureOutcome = failure(err, 'The preset was not saved.') as LibraryResult<
            PresetLibraryRecord
          >;
          try {
            tx.abort();
          } catch {}
        }
      };
      all.onerror = () => {
        failureOutcome = failure(all.error, 'Could not read the preset library.') as LibraryResult<
          PresetLibraryRecord
        >;
      };
      tx.oncomplete = () => done(true);
      tx.onabort = () => {
        failureOutcome =
          failureOutcome ??
          (failure(tx.error, 'Saving the preset was aborted.') as LibraryResult<
            PresetLibraryRecord
          >);
        done(false);
      };
      tx.onerror = () => {
        /* A request error aborts the transaction and `onabort` resolves; do not
           settle here, or a quota error on `put` would be read as success. */
        if (!failureOutcome) {
          failureOutcome = failure(tx.error, 'The preset was not saved.') as LibraryResult<
            PresetLibraryRecord
          >;
        }
      };
    } catch (err) {
      failureOutcome = failure(err, 'The preset was not saved.') as LibraryResult<
        PresetLibraryRecord
      >;
      done(false);
    }
  });
}

/** Delete one record by id. Deleting a missing id still succeeds. */
export async function deletePresetRecord(id: string): Promise<LibraryResult<true>> {
  if (typeof id !== 'string' || !id.trim()) {
    return { ok: false, reason: 'error', message: 'No preset was named for deletion.' };
  }
  const db = await openDb();
  if (!db) return UNAVAILABLE;
  return new Promise((resolve) => {
    let failureResult: LibraryResult<true> | null = null;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      try {
        db.close();
      } catch {}
      resolve(failureResult ?? { ok: true, value: true });
    };
    try {
      const tx = db.transaction(PRESET_LIBRARY_STORE, 'readwrite');
      tx.objectStore(PRESET_LIBRARY_STORE).delete(id.trim());
      tx.oncomplete = done;
      tx.onabort = () => {
        failureResult =
          failureResult ?? (failure(tx.error, 'Deleting the preset was aborted.') as LibraryResult<true>);
        done();
      };
      tx.onerror = () => {
        failureResult =
          failureResult ?? (failure(tx.error, 'The preset could not be deleted.') as LibraryResult<true>);
      };
    } catch (err) {
      failureResult = failure(err, 'The preset could not be deleted.') as LibraryResult<true>;
      done();
    }
  });
}
