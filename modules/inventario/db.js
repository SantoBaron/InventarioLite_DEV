const DB_NAME = "mini_inventario_db";
const DB_VER = 3;
const STORE = "lines";
const ISSUE_SESSIONS_STORE = "issue_sessions";
const ISSUE_LINES_STORE = "issue_lines";
const ISSUE_REQUESTS_STORE = "issue_requests";

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

      if (!db.objectStoreNames.contains(ISSUE_REQUESTS_STORE)) {
        const reqs = db.createObjectStore(ISSUE_REQUESTS_STORE, { keyPath: "id" });
        reqs.createIndex("by_day", "dayKey", { unique: false });
        reqs.createIndex("by_ref", "requestRef", { unique: false });
        reqs.createIndex("by_createdAt", "createdAt", { unique: false });
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
function txIssueRequests(db, mode = "readonly") {
  return db.transaction(ISSUE_REQUESTS_STORE, mode).objectStore(ISSUE_REQUESTS_STORE);
}

export async function getAllLines(db) {
  return new Promise((resolve, reject) => {
    const idx = tx(db, "readonly").index("by_createdAt");
    const req = idx.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
export async function putLine(db, line) {
  return new Promise((resolve, reject) => {
    const req = tx(db, "readwrite").put(line);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}
export async function deleteLine(db, id) {
  return new Promise((resolve, reject) => {
    const req = tx(db, "readwrite").delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}
export async function clearAll(db) {
  return new Promise((resolve, reject) => {
    const req = tx(db, "readwrite").clear();
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}
export async function findByKey(db, key) {
  return new Promise((resolve, reject) => {
    const idx = tx(db, "readonly").index("by_key");
    const req = idx.getAll(IDBKeyRange.only(key));
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function putIssueSession(db, session) {
  return new Promise((resolve, reject) => {
    const req = txIssueSessions(db, "readwrite").put(session);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}
export async function getIssueSessionsByDay(db, dayKey) {
  return new Promise((resolve, reject) => {
    const idx = txIssueSessions(db, "readonly").index("by_day");
    const req = idx.getAll(IDBKeyRange.only(dayKey));
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
export async function deleteIssueSession(db, id) {
  return new Promise((resolve, reject) => {
    const req = txIssueSessions(db, "readwrite").delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function putIssueLine(db, line) {
  return new Promise((resolve, reject) => {
    const req = txIssueLines(db, "readwrite").put(line);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}
export async function deleteIssueLine(db, id) {
  return new Promise((resolve, reject) => {
    const req = txIssueLines(db, "readwrite").delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}
export async function getIssueLinesBySession(db, sessionId) {
  return new Promise((resolve, reject) => {
    const idx = txIssueLines(db, "readonly").index("by_session");
    const req = idx.getAll(IDBKeyRange.only(sessionId));
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
export async function getIssueLinesByDay(db, dayKey) {
  return new Promise((resolve, reject) => {
    const idx = txIssueLines(db, "readonly").index("by_day");
    const req = idx.getAll(IDBKeyRange.only(dayKey));
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
export async function findIssueLineBySessionAggKey(db, sessionId, aggKey) {
  if (!aggKey) return [];
  return new Promise((resolve, reject) => {
    const idx = txIssueLines(db, "readonly").index("by_session_agg");
    const req = idx.getAll(IDBKeyRange.only([sessionId, aggKey]));
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function putIssueRequest(db, row) {
  return new Promise((resolve, reject) => {
    const req = txIssueRequests(db, "readwrite").put(row);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}
export async function getIssueRequestsByDay(db, dayKey) {
  return new Promise((resolve, reject) => {
    const idx = txIssueRequests(db, "readonly").index("by_day");
    const req = idx.getAll(IDBKeyRange.only(dayKey));
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
export async function clearIssueRequestsByDay(db, dayKey) {
  const rows = await getIssueRequestsByDay(db, dayKey);
  for (const row of rows) {
    await new Promise((resolve, reject) => {
      const req = txIssueRequests(db, "readwrite").delete(row.id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }
  return true;
}
