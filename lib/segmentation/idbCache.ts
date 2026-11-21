/**
 * IndexedDB-backed cache. Used (1) as transformers.js `customCache` so the SAM
 * model and ONNX Runtime WASM are downloaded once and survive reloads, and
 * (2) for small binary blobs such as the constant positional embeddings.
 */

const DB_NAME = "colorvision-models";
const STORE = "files";
const VERSION = 1;

export type Entry = { body: ArrayBuffer; contentType: string | null; storedAt: number };

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    });
    dbPromise.catch(() => (dbPromise = null));
  }
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
      }),
  );
}

export async function idbGet(key: string): Promise<Entry | undefined> {
  try {
    return await tx<Entry | undefined>("readonly", (s) => s.get(key) as IDBRequest<Entry | undefined>);
  } catch {
    return undefined;
  }
}

export async function idbPut(key: string, body: ArrayBuffer, contentType: string | null = null): Promise<void> {
  try {
    await tx("readwrite", (s) => s.put({ body, contentType, storedAt: Date.now() } satisfies Entry, key));
  } catch {
    /* quota exceeded or private mode: continue without caching */
  }
}

export async function idbDelete(key: string): Promise<void> {
  try {
    await tx("readwrite", (s) => s.delete(key));
  } catch {
    /* ignore */
  }
}

type Progress = (data: { progress: number; loaded: number; total: number }) => void;

async function readWithProgress(response: Response, onProgress?: Progress): Promise<ArrayBuffer> {
  const total = Number(response.headers.get("content-length")) || 0;
  if (!response.body || !onProgress) return response.arrayBuffer();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress({ progress: total ? (loaded / total) * 100 : 0, loaded, total });
  }
  const out = new Uint8Array(loaded);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out.buffer;
}

/** Implements the subset of the Web Cache API that transformers.js uses. */
export const idbModelCache = {
  async match(request: string): Promise<Response | undefined> {
    const e = await idbGet(`http:${request}`);
    if (!e) return undefined;
    const headers = new Headers({ "content-length": String(e.body.byteLength) });
    if (e.contentType) headers.set("content-type", e.contentType);
    return new Response(e.body, { status: 200, headers });
  },
  async put(request: string, response: Response, progress?: Progress): Promise<void> {
    const body = await readWithProgress(response, progress);
    await idbPut(`http:${request}`, body, response.headers.get("content-type"));
  },
};
