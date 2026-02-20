const DB_NAME = "mini_inventario_db";
const DB_VER = 1;
const STORE = "lines";

/**
 * Esquema:
 * {
 *   id: string (uuid),
 *   ubicacion: string,
 *   ref: string,
 *   lote: string|null,
 *   sublote: string|null,
 *   cantidad: number,
 *   createdAt: number (ms)
 * }
 */
export function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("by_createdAt", "createdAt", { unique: false });
        os.createIndex("by_key", "key", { unique: false }); // key = ubic|ref|lote|sublote
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode = "readonly") {
  return db.transaction(STORE, mode).objectStore(STORE);
}

export async function getAllLines(db) {
  return new Promise((resolve, reject) => {
    const store = tx(db, "readonly");
    const idx = store.index("by_createdAt");
    const req = idx.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function putLine(db, line) {
  return new Promise((resolve, reject) => {
    const store = tx(db, "readwrite");
    const req = store.put(line);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteLine(db, id) {
  return new Promise((resolve, reject) => {
    const store = tx(db, "readwrite");
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function clearAll(db) {
  return new Promise((resolve, reject) => {
    const store = tx(db, "readwrite");
    const req = store.clear();
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Busca si existe una línea por key exacta (ubic|ref|lote|sublote)
 */
export async function findByKey(db, key) {
  return new Promise((resolve, reject) => {
    const store = tx(db, "readonly");
    const idx = store.index("by_key");
    const req = idx.getAll(IDBKeyRange.only(key));
    req.onsuccess = () => {
      const arr = req.result || [];
      resolve(arr);
    };
    req.onerror = () => reject(req.error);
  });
}
