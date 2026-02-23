import {
  openDb,
  putIssueSession,
  putIssueLine,
  getIssueLinesBySession,
  deleteIssueLine,
  findIssueLineBySessionAggKey,
  deleteIssueSession,
  putIssueRequest,
  getIssueRequestsByDay,
} from "../inventario/db.js";
import { parseGs1 } from "../inventario/gs1.js";

const el = {
  cecoInput: document.getElementById("cecoInput"),
  operarioInput: document.getElementById("operarioInput"),
  btnStart: document.getElementById("btnStart"),
  btnFinish: document.getElementById("btnFinish"),
  btnResetSession: document.getElementById("btnResetSession"),
  sessionInfo: document.getElementById("sessionInfo"),
  scanInput: document.getElementById("scanInput"),
  btnManual: document.getElementById("btnManual"),
  btnManualCode: document.getElementById("btnManualCode"),
  btnUndo: document.getElementById("btnUndo"),
  msg: document.getElementById("msg"),
  linesCount: document.getElementById("linesCount"),
  unitsCount: document.getElementById("unitsCount"),
  lastRead: document.getElementById("lastRead"),
  tbody: document.getElementById("tbody"),
  manualDialog: document.getElementById("manualDialog"),
  manualForm: document.getElementById("manualForm"),
  manualRef: document.getElementById("manualRef"),
  manualLote: document.getElementById("manualLote"),
  manualSublote: document.getElementById("manualSublote"),
  manualQty: document.getElementById("manualQty"),
  btnManualCancel: document.getElementById("btnManualCancel"),
  manualCodeDialog: document.getElementById("manualCodeDialog"),
  manualCodeForm: document.getElementById("manualCodeForm"),
  manualCodeInput: document.getElementById("manualCodeInput"),
  btnManualCodeCancel: document.getElementById("btnManualCodeCancel"),
};

let db;
let currentSession = null;
let sessionLines = [];
let lastAction = null;

const uuid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const dayKey = (ts = Date.now()) => new Date(ts).toISOString().slice(0, 10);
const hour = (ts) => new Date(ts).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const norm = (s) => (s ?? "").trim();
const safeOn = (n, e, f) => n && n.addEventListener(e, f);

function setMsg(text = "", kind = "") {
  el.msg.textContent = text;
  el.msg.className = `msg ${kind}`;
}

function buildAggKey(sessionId, ceco, ref, lote, caducidad) {
  return [sessionId, ceco, ref || "", lote || "", caducidad || ""].join("|");
}

function normalizeScannerRaw(raw) {
  let s = String(raw ?? "");
  s = s.replaceAll("\uFFFD", "Ê");
  s = s.replace(/[\x00-\x1F]/g, "Ê");
  s = s.replace(/Ê+/g, "Ê");
  return s;
}
function stripDemoPrefix(raw) {
  let s = (raw ?? "").trim();
  const up = s.toUpperCase();
  if (up === "DEMO") return "";
  if (up.startsWith("DEMO")) s = s.slice(4).trim();
  return s;
}

async function refreshSessionLines() {
  sessionLines = currentSession ? (await getIssueLinesBySession(db, currentSession.id)).sort((a, b) => a.createdAt - b.createdAt) : [];
  const units = sessionLines.reduce((acc, l) => acc + Number(l.cantidad || 0), 0);
  el.linesCount.textContent = String(sessionLines.length);
  el.unitsCount.textContent = String(units);
  el.tbody.innerHTML = sessionLines.map((l) => `
    <tr>
      <td>${hour(l.createdAt)}</td>
      <td>${l.ceco}</td>
      <td>${l.ref}</td>
      <td>${l.serial || l.lote || "-"}</td>
      <td>${l.cantidad}</td>
      <td><button class="mini danger" data-action="delete" data-id="${l.id}" type="button">Borrar</button></td>
    </tr>
  `).join("");
}

async function setEnabledForOperation(enabled) {
  el.scanInput.disabled = !enabled;
  el.btnManual.disabled = !enabled;
  el.btnManualCode.disabled = !enabled;
  el.btnUndo.disabled = !enabled;
  el.btnFinish.disabled = !enabled;
  el.btnStart.disabled = enabled;
  el.cecoInput.disabled = enabled;
  el.operarioInput.disabled = enabled;
  el.btnResetSession.disabled = !enabled;
}

async function startSession() {
  const ceco = norm(el.cecoInput.value);
  const operario = norm(el.operarioInput.value);
  if (!ceco || !operario) return setMsg("CECO y operario son obligatorios.", "err");

  currentSession = { id: uuid(), ceco, operario, startedAt: Date.now(), endedAt: null, status: "open", dayKey: dayKey() };
  await putIssueSession(db, currentSession);
  await setEnabledForOperation(true);
  await refreshSessionLines();
  el.sessionInfo.textContent = `Solicitud activa · CECO ${ceco} · Operario ${operario}`;
  setMsg("Solicitud iniciada.", "ok");
  el.scanInput.focus();
}

async function finishRequest() {
  if (!currentSession) return;
  if (!sessionLines.length) {
    setMsg("No hay líneas para cerrar la solicitud.", "err");
    return;
  }

  const fecha = dayKey();
  const requestRef = `${fecha}-${currentSession.ceco}-${currentSession.operario}`;
  for (const line of sessionLines) {
    await putIssueRequest(db, {
      id: uuid(),
      dayKey: fecha,
      requestRef,
      sessionId: currentSession.id,
      ceco: currentSession.ceco,
      operario: currentSession.operario,
      ref: line.ref,
      lote: line.lote || null,
      sublote: line.serial || line.sublote || null,
      cantidad: line.cantidad,
      createdAt: line.createdAt,
    });
  }

  currentSession.endedAt = Date.now();
  currentSession.status = "closed";
  await putIssueSession(db, currentSession);

  currentSession = null;
  lastAction = null;
  await setEnabledForOperation(false);
  el.cecoInput.value = "";
  el.operarioInput.value = "";
  el.sessionInfo.textContent = "No hay solicitud activa.";
  el.lastRead.textContent = "—";
  await refreshSessionLines();
  setMsg(`Fin de solicitud registrado (${requestRef}).`, "ok");
}

async function addLineFromData(data, qty = 1) {
  if (!currentSession) return setMsg("Primero inicia una solicitud.", "err");
  const ref = norm(data.ref);
  const lote = norm(data.lote) || null;
  const sublote = norm(data.serial || data.sublote) || null;
  const now = Date.now();
  if (!ref) return setMsg("Referencia vacía.", "err");

  if (sublote) {
    const dup = sessionLines.find((l) => norm(l.ref).toUpperCase() === ref.toUpperCase() && norm(l.lote).toUpperCase() === norm(lote).toUpperCase() && norm(l.serial || l.sublote).toUpperCase() === sublote.toUpperCase());
    if (dup) return setMsg(`DUPLICADO rechazado: ${ref}/${lote ?? "-"}/${sublote}`, "err");
    const line = { id: uuid(), sessionId: currentSession.id, ceco: currentSession.ceco, ref, lote, sublote, serial: sublote, cantidad: 1, createdAt: now, dayKey: currentSession.dayKey, isSerial: true, aggKey: null };
    await putIssueLine(db, line);
    lastAction = { type: "insert", lineId: line.id };
    el.lastRead.textContent = `${ref} [${sublote}]`;
    await refreshSessionLines();
    return;
  }

  const aggKey = buildAggKey(currentSession.id, currentSession.ceco, ref, lote, null);
  const existing = await findIssueLineBySessionAggKey(db, currentSession.id, aggKey);
  const row = (existing || []).find((x) => !x.isSerial);
  if (row) {
    const prevQty = Number(row.cantidad || 0);
    row.cantidad = prevQty + qty;
    row.createdAt = now;
    await putIssueLine(db, row);
    lastAction = { type: "merge", lineId: row.id, prevQty };
  } else {
    const line = { id: uuid(), sessionId: currentSession.id, ceco: currentSession.ceco, ref, lote, sublote: null, serial: null, cantidad: qty, createdAt: now, dayKey: currentSession.dayKey, isSerial: false, aggKey };
    await putIssueLine(db, line);
    lastAction = { type: "insert", lineId: line.id };
  }
  el.lastRead.textContent = ref;
  await refreshSessionLines();
}

async function handleScan(rawInput) {
  let raw = norm(stripDemoPrefix(normalizeScannerRaw(rawInput)));
  if (!raw) return;
  const gs1 = parseGs1(raw);
  return gs1?.ref ? addLineFromData(gs1, 1) : addLineFromData({ ref: raw }, 1);
}

async function undoLast() {
  if (!lastAction) return setMsg("No hay acción para deshacer.", "err");
  const line = sessionLines.find((x) => x.id === lastAction.lineId);
  if (!line) return;
  if (lastAction.type === "insert") await deleteIssueLine(db, line.id);
  else { line.cantidad = lastAction.prevQty; await putIssueLine(db, line); }
  lastAction = null;
  await refreshSessionLines();
}

async function deleteRowById(id) {
  const line = sessionLines.find((x) => x.id === id);
  if (!line) return;
  if (!window.confirm(`Eliminar registro ${line.ref} / ${line.lote ?? "-"} / ${line.serial ?? "-"}?`)) return;
  await deleteIssueLine(db, line.id);
  await refreshSessionLines();
}

async function resetCurrentSession() {
  if (!currentSession) return setMsg("No hay solicitud activa para borrar.", "err");
  const reqsToday = await getIssueRequestsByDay(db, dayKey());
  if (reqsToday.length > 0) return setMsg("No se permite reset: ya hay solicitudes cerradas pendientes de FIN DE DIA.", "err");
  if (!window.confirm("Se borrará todo el registro, continuar?")) return;
  for (const line of await getIssueLinesBySession(db, currentSession.id)) await deleteIssueLine(db, line.id);
  await deleteIssueSession(db, currentSession.id);
  currentSession = null;
  await setEnabledForOperation(false);
  el.sessionInfo.textContent = "No hay solicitud activa.";
  await refreshSessionLines();
  setMsg("Solicitud borrada.", "warn");
}

function hookScannerInput() {
  let buffer = "";
  let timer = null;
  function ignore(target) {
    if (el.manualDialog?.open || el.manualCodeDialog?.open) return true;
    const active = target || document.activeElement;
    if (!active) return false;
    if (active === el.scanInput) return false;
    const tag = active.tagName?.toUpperCase?.() || "";
    return active.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => { if (buffer.trim()) flush(); }, 90);
  }
  function flush() {
    const value = buffer.trim();
    buffer = "";
    el.scanInput.value = "";
    clearTimeout(timer);
    timer = null;
    if (!value) return;
    handleScan(value).catch((e) => setMsg(e.message, "err"));
  }
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey || ignore(e.target)) return;
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); return flush(); }
    if (e.key === "Backspace") { buffer = buffer.slice(0, -1); return schedule(); }
    if (e.key.length === 1) { buffer += e.key; schedule(); }
  });
  safeOn(el.scanInput, "input", () => { if (!ignore(el.scanInput) && el.scanInput.value) { buffer = el.scanInput.value; schedule(); } });
  safeOn(el.scanInput, "paste", () => { if (!ignore(el.scanInput) && el.scanInput.value) { buffer = el.scanInput.value; schedule(); } });
}

function bindEvents() {
  safeOn(el.btnStart, "click", () => startSession().catch((e) => setMsg(e.message, "err")));
  safeOn(el.btnFinish, "click", () => finishRequest().catch((e) => setMsg(e.message, "err")));
  safeOn(el.btnUndo, "click", () => undoLast().catch((e) => setMsg(e.message, "err")));
  safeOn(el.btnResetSession, "click", () => resetCurrentSession().catch((e) => setMsg(e.message, "err")));

  safeOn(el.btnManual, "click", () => {
    el.manualRef.value = ""; el.manualLote.value = ""; el.manualSublote.value = ""; el.manualQty.value = "1";
    el.manualDialog.showModal();
  });
  safeOn(el.btnManualCode, "click", () => { el.manualCodeInput.value = ""; el.manualCodeDialog.showModal(); });
  safeOn(el.btnManualCancel, "click", () => el.manualDialog.close());
  safeOn(el.btnManualCodeCancel, "click", () => el.manualCodeDialog.close());

  safeOn(el.manualForm, "submit", (evt) => {
    evt.preventDefault();
    const ref = norm(el.manualRef.value);
    if (!ref) return setMsg("La referencia es obligatoria.", "err");
    const sub = norm(el.manualSublote.value) || null;
    const qty = sub ? 1 : Math.max(1, Number(el.manualQty.value || 1));
    addLineFromData({ ref, lote: norm(el.manualLote.value) || null, sublote: sub }, qty)
      .then(() => el.manualDialog.close())
      .catch((e) => setMsg(e.message, "err"));
  });

  safeOn(el.manualCodeForm, "submit", (evt) => {
    evt.preventDefault();
    const raw = norm(el.manualCodeInput.value);
    if (!raw) return setMsg("Debe indicar un código manual.", "err");
    handleScan(raw).then(() => el.manualCodeDialog.close()).catch((e) => setMsg(e.message, "err"));
  });

  safeOn(el.tbody, "click", (evt) => {
    const btn = evt.target.closest("button[data-action='delete']");
    if (btn) deleteRowById(btn.dataset.id).catch((e) => setMsg(e.message, "err"));
  });
}

async function init() {
  db = await openDb();
  await setEnabledForOperation(false);
  bindEvents();
  hookScannerInput();
  await refreshSessionLines();
}

init().catch((e) => {
  console.error(e);
  setMsg(`Error iniciando: ${e.message}`, "err");
});
