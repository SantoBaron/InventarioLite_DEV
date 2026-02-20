const DB_NAME = "mini_inventario_db";
const DB_VER = 2;
const STORE = "lines";
const ISSUE_SESSIONS_STORE = "issue_sessions";
const ISSUE_LINES_STORE = "issue_lines";

/**
 * Esquema inventario (STORE = lines):
 * {
 *   id: string (uuid),
 *   ubicacion: string,
 *   ref: string,
 *   lote: string|null,
 *   sublote: string|null,
 *   cantidad: number,
 *   createdAt: number (ms),
 *   key: string // ubic|ref|lote|sublote
 * }
 *
 * Esquema salidas (offline-first):
 * - issue_sessions:
 *   {
 *     id: string,
 *     ceco: string,
 *     operario: string,
 *     startedAt: number,
 *     endedAt: number|null,
 *     status: "open"|"closed"|"exported",
 *     dayKey: string // YYYY-MM-DD
 *   }
 * - issue_lines:
 *   {
 *     id: string,
 *     sessionId: string,
 *     ceco: string,
 *     ref: string,
 *     lote: string|null,
 *     sublote: string|null,  // usado como serie cuando aplique
 *     serial: string|null,
 *     caducidad: string|null,
 *     cantidad: number,
 *     createdAt: number,
 *     dayKey: string,
 *     exportedAt: number|null,
 *     isSerial: boolean,
 *     aggKey: string|null // deduplicación para NO serie: sessionId|ceco|ref|lote|caducidad
 *   }
 */
export function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("by_createdAt", "createdAt", { unique: false });
        os.createIndex("by_key", "key", { unique: false });
      }

      if (!db.objectStoreNames.contains(ISSUE_SESSIONS_STORE)) {
        const sessions = db.createObjectStore(ISSUE_SESSIONS_STORE, { keyPath: "id" });
        sessions.createIndex("by_day", "dayKey", { unique: false });
        sessions.createIndex("by_status", "status", { unique: false });
        sessions.createIndex("by_startedAt", "startedAt", { unique: false });
      }

      if (!db.objectStoreNames.contains(ISSUE_LINES_STORE)) {
        const lines = db.createObjectStore(ISSUE_LINES_STORE, { keyPath: "id" });
        lines.createIndex("by_day", "dayKey", { unique: false });
        lines.createIndex("by_session", "sessionId", { unique: false });
        lines.createIndex("by_createdAt", "createdAt", { unique: false });
        lines.createIndex("by_exportedAt", "exportedAt", { unique: false });
        lines.createIndex("by_session_agg", ["sessionId", "aggKey"], { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode = "readonly") {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function txIssueSessions(db, mode = "readonly") {
  return db.transaction(ISSUE_SESSIONS_STORE, mode).objectStore(ISSUE_SESSIONS_STORE);
}

function txIssueLines(db, mode = "readonly") {
  return db.transaction(ISSUE_LINES_STORE, mode).objectStore(ISSUE_LINES_STORE);
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

/** Busca si existe una línea por key exacta (ubic|ref|lote|sublote) */
export async function findByKey(db, key) {
  return new Promise((resolve, reject) => {
    const store = tx(db, "readonly");
    const idx = store.index("by_key");
    const req = idx.getAll(IDBKeyRange.only(key));
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function putIssueSession(db, session) {
  return new Promise((resolve, reject) => {
    const store = txIssueSessions(db, "readwrite");
    const req = store.put(session);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function getIssueSessionById(db, id) {
  return new Promise((resolve, reject) => {
    const store = txIssueSessions(db, "readonly");
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function getIssueSessionsByDay(db, dayKey) {
  return new Promise((resolve, reject) => {
    const store = txIssueSessions(db, "readonly");
    const idx = store.index("by_day");
    const req = idx.getAll(IDBKeyRange.only(dayKey));
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteIssueSession(db, id) {
  return new Promise((resolve, reject) => {
    const store = txIssueSessions(db, "readwrite");
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function putIssueLine(db, line) {
  return new Promise((resolve, reject) => {
    const store = txIssueLines(db, "readwrite");
    const req = store.put(line);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteIssueLine(db, id) {
  return new Promise((resolve, reject) => {
    const store = txIssueLines(db, "readwrite");
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function getIssueLinesBySession(db, sessionId) {
  return new Promise((resolve, reject) => {
    const store = txIssueLines(db, "readonly");
    const idx = store.index("by_session");
    const req = idx.getAll(IDBKeyRange.only(sessionId));
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function getIssueLinesByDay(db, dayKey) {
  return new Promise((resolve, reject) => {
    const store = txIssueLines(db, "readonly");
    const idx = store.index("by_day");
    const req = idx.getAll(IDBKeyRange.only(dayKey));
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function findIssueLineBySessionAggKey(db, sessionId, aggKey) {
  if (!aggKey) return [];
  return new Promise((resolve, reject) => {
    const store = txIssueLines(db, "readonly");
    const idx = store.index("by_session_agg");
    const req = idx.getAll(IDBKeyRange.only([sessionId, aggKey]));
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
