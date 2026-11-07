const DB_NAME = 'rawlab';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('presets')) db.createObjectStore('presets', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
    t.onerror = () => reject(t.error);
  });
}

export async function idbGetAll<T>(store: string): Promise<T[]> {
  try {
    const keys = await tx<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys());
    const out: T[] = [];
    for (const key of keys) {
      const v = await tx<T | undefined>(store, 'readonly', (s) => s.get(key));
      if (v !== undefined) out.push(v);
    }
    return out;
  } catch {
    return [];
  }
}

export async function idbPut(store: string, value: unknown, key?: IDBValidKey): Promise<void> {
  try {
    await tx(store, 'readwrite', (s) => (key === undefined ? s.put(value) : s.put(value, key)));
  } catch {
    // Autosave must never break the editor.
  }
}

export async function idbDelete(store: string, key: IDBValidKey): Promise<void> {
  try {
    await tx(store, 'readwrite', (s) => s.delete(key));
  } catch {
    // ignore
  }
}

export async function idbGet<T>(store: string, key: IDBValidKey): Promise<T | null> {
  try {
    return (await tx<T | undefined>(store, 'readonly', (s) => s.get(key))) ?? null;
  } catch {
    return null;
  }
}
