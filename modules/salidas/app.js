import {
  openDb,
  putIssueSession,
  putIssueLine,
  getIssueLinesBySession,
  deleteIssueLine,
  findIssueLineBySessionAggKey,
  getIssueLinesByDay,
  getIssueSessionsByDay,
} from "../inventario/db.js";
import { parseGs1 } from "../inventario/gs1.js";

const el = {
  cecoInput: document.getElementById("cecoInput"),
  operarioInput: document.getElementById("operarioInput"),
  btnStart: document.getElementById("btnStart"),
  btnFinish: document.getElementById("btnFinish"),
  btnDayClose: document.getElementById("btnDayClose"),
  sessionInfo: document.getElementById("sessionInfo"),
  scanInput: document.getElementById("scanInput"),
  btnManual: document.getElementById("btnManual"),
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
};

let db;
let currentSession = null;
let sessionLines = [];
let lastAction = null; // { type: 'insert'|'merge', lineId, prevQty }

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function dayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

function hour(ts) {
  return new Date(ts).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function norm(s) {
  return (s ?? "").trim();
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setMsg(text = "", kind = "") {
  el.msg.textContent = text;
  el.msg.className = `msg ${kind}`;
}

function safeOn(node, evt, fn) {
  if (!node) return;
  node.addEventListener(evt, fn);
}

function buildAggKey(sessionId, ceco, ref, lote, caducidad) {
  return [sessionId, ceco, ref || "", lote || "", caducidad || ""].join("|");
}

function buildSerialKey(ref, lote, serial) {
  return [ref || "", lote || "", serial || ""].join("|").toUpperCase();
}

function parseCommand(raw) {
  const s = norm(raw).toUpperCase();
  if (s === "FIN" || s === "FINALIZAR") return { cmd: "FIN" };
  if (s === "CIERRE" || s === "CIERRE DIA") return { cmd: "DAY_CLOSE" };
  return null;
}

function stripDemoPrefix(raw) {
  let s = (raw ?? "").trim();
  const up = s.toUpperCase();
  if (up === "DEMO") return "";
  if (up.startsWith("DEMO")) s = s.slice(4).trim();
  return s;
}

function normalizeScannerRaw(raw) {
  let s = String(raw ?? "");
  s = s.replaceAll("\uFFFD", "Ê");
  s = s.replace(/[\x00-\x1F]/g, "Ê");
  s = s.replace(/Ê+/g, "Ê");
  return s;
}

async function refreshSessionLines() {
  if (!currentSession) {
    sessionLines = [];
  } else {
    sessionLines = (await getIssueLinesBySession(db, currentSession.id)).sort((a, b) => a.createdAt - b.createdAt);
  }

  let units = 0;
  for (const line of sessionLines) units += Number(line.cantidad || 0);

  el.linesCount.textContent = String(sessionLines.length);
  el.unitsCount.textContent = String(units);

  el.tbody.innerHTML = sessionLines
    .map((l) => `
      <tr>
        <td>${hour(l.createdAt)}</td>
        <td>${escapeHtml(l.ceco)}</td>
        <td>${escapeHtml(l.ref)}</td>
        <td>${escapeHtml(l.serial || l.lote || "-")}</td>
        <td>${l.cantidad}</td>
      </tr>
    `)
    .join("");
}

function setEnabledForOperation(enabled) {
  el.scanInput.disabled = !enabled;
  el.btnManual.disabled = !enabled;
  el.btnUndo.disabled = !enabled;
  el.btnFinish.disabled = !enabled;
  el.btnStart.disabled = enabled;
  el.cecoInput.disabled = enabled;
  el.operarioInput.disabled = enabled;
}

async function startSession() {
  const ceco = norm(el.cecoInput.value);
  const operario = norm(el.operarioInput.value);
  if (!ceco || !operario) {
    setMsg("CECO y operario son obligatorios.", "err");
    return;
  }

  currentSession = {
    id: uuid(),
    ceco,
    operario,
    startedAt: Date.now(),
    endedAt: null,
    status: "open",
    dayKey: dayKey(),
  };

  await putIssueSession(db, currentSession);
  setEnabledForOperation(true);
  lastAction = null;
  await refreshSessionLines();
  el.sessionInfo.textContent = `Salida activa · CECO ${ceco} · Operario ${operario}`;
  setMsg("Salida iniciada. Puede escanear artículos.", "ok");
  el.scanInput.focus();
}

async function finishSession() {
  if (!currentSession) return;
  currentSession.endedAt = Date.now();
  currentSession.status = "closed";
  await putIssueSession(db, currentSession);
  setMsg(`Salida finalizada (${currentSession.ceco}).`, "ok");
  currentSession = null;
  lastAction = null;
  setEnabledForOperation(false);
  el.sessionInfo.textContent = "No hay salida activa.";
  el.lastRead.textContent = "—";
  await refreshSessionLines();
}

async function addLineFromData(data, qty = 1) {
  if (!currentSession) {
    setMsg("Primero inicia una salida (CECO + Operario).", "err");
    return;
  }

  const ref = norm(data.ref);
  const lote = norm(data.lote) || null;
  const serial = norm(data.serial || data.sublote) || null;
  const caducidad = norm(data.caducidad) || null;
  const hasSublote = Boolean(serial);
  const now = Date.now();

  if (!ref) {
    setMsg("Referencia vacía.", "err");
    return;
  }

  if (hasSublote) {
    const serialKey = buildSerialKey(ref, lote, serial);
    const duplicated = sessionLines.find((line) => buildSerialKey(line.ref, line.lote, line.serial || line.sublote) === serialKey);
    if (duplicated) {
      setMsg(`DUPLICADO rechazado: ${ref} / ${lote ?? "-"} / ${serial}`, "err");
      return;
    }

    const line = {
      id: uuid(),
      sessionId: currentSession.id,
      ceco: currentSession.ceco,
      ref,
      lote,
      sublote: serial,
      serial,
      caducidad,
      cantidad: 1, // Ref-Lote-Sublote existe unitariamente
      createdAt: now,
      dayKey: currentSession.dayKey,
      exportedAt: null,
      isSerial: true,
      aggKey: null,
    };

    await putIssueLine(db, line);
    lastAction = { type: "insert", lineId: line.id };
    el.lastRead.textContent = `${ref} [${serial}]`;
    setMsg(`OK: ${ref} / ${lote ?? "-"} / ${serial} (1 ud).`, "ok");
    await refreshSessionLines();
    return;
  }

  const aggKey = buildAggKey(currentSession.id, currentSession.ceco, ref, lote, caducidad);
  const existing = await findIssueLineBySessionAggKey(db, currentSession.id, aggKey);
  const candidate = (existing || []).find((line) => !line.isSerial);
  if (candidate) {
    const prevQty = Number(candidate.cantidad || 0);
    candidate.cantidad = prevQty + qty;
    candidate.createdAt = now;
    await putIssueLine(db, candidate);
    lastAction = { type: "merge", lineId: candidate.id, prevQty };
    el.lastRead.textContent = `${ref} (+${qty})`;
    setMsg(`OK (agregado): ${ref} / ${lote ?? "-"} → ${candidate.cantidad}.`, "ok");
    await refreshSessionLines();
    return;
  }

  const line = {
    id: uuid(),
    sessionId: currentSession.id,
    ceco: currentSession.ceco,
    ref,
    lote,
    sublote: null,
    serial: null,
    caducidad,
    cantidad: qty,
    createdAt: now,
    dayKey: currentSession.dayKey,
    exportedAt: null,
    isSerial: false,
    aggKey,
  };
  await putIssueLine(db, line);
  lastAction = { type: "insert", lineId: line.id };
  el.lastRead.textContent = ref;
  setMsg(`OK: ${ref} / ${lote ?? "-"} (${qty}).`, "ok");
  await refreshSessionLines();
}

async function handleScan(rawInput) {
  let raw = normalizeScannerRaw(rawInput);
  raw = stripDemoPrefix(raw);
  raw = norm(raw);
  if (!raw) return;

  const cmd = parseCommand(raw);
  if (cmd?.cmd === "FIN") return finishSession();
  if (cmd?.cmd === "DAY_CLOSE") return closeDayAndExport();

  const parsed = parseGs1(raw);
  if (parsed?.ref) {
    await addLineFromData(parsed, 1);
  } else {
    await addLineFromData({ ref: raw }, 1);
  }
}

async function undoLast() {
  if (!lastAction) {
    setMsg("No hay acción para deshacer.", "err");
    return;
  }

  const line = sessionLines.find((x) => x.id === lastAction.lineId);
  if (!line) {
    setMsg("No se encontró la última línea.", "err");
    return;
  }

  if (lastAction.type === "insert") {
    await deleteIssueLine(db, line.id);
  } else if (lastAction.type === "merge") {
    line.cantidad = lastAction.prevQty;
    await putIssueLine(db, line);
  }

  lastAction = null;
  setMsg("Última acción deshecha.", "ok");
  await refreshSessionLines();
}

function exportCsv(rows, filename) {
  const csv = rows.map((row) => row.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(";")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function closeDayAndExport() {
  const today = dayKey();
  const lines = (await getIssueLinesByDay(db, today)).sort((a, b) => a.createdAt - b.createdAt);
  if (!lines.length) {
    setMsg("No hay salidas del día para exportar.", "err");
    return;
  }

  const rows = [
    ["FECHA", "HORA", "CECO", "OPERARIO", "REFERENCIA", "LOTE", "SERIE", "CANTIDAD"],
  ];
  const sessions = await getIssueSessionsByDay(db, today);
  const opBySession = new Map(sessions.map((s) => [s.id, s.operario]));

  for (const l of lines) {
    rows.push([
      l.dayKey,
      hour(l.createdAt),
      l.ceco,
      opBySession.get(l.sessionId) || "",
      l.ref,
      l.lote || "",
      l.serial || "",
      l.cantidad,
    ]);
  }

  const byCecoThenHour = rows.slice(1).sort((a, b) => `${a[2]}_${a[1]}`.localeCompare(`${b[2]}_${b[1]}`));

  if (window.XLSX) {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([rows[0], ...byCecoThenHour]);
    XLSX.utils.book_append_sheet(wb, ws, "Salidas");
    XLSX.writeFile(wb, `salidas_${today}.xlsx`);
  } else {
    exportCsv([rows[0], ...byCecoThenHour], `salidas_${today}.csv`);
  }

  const exportTs = Date.now();
  for (const l of lines) {
    l.exportedAt = exportTs;
    await putIssueLine(db, l);
  }
  for (const s of sessions) {
    s.status = "exported";
    if (!s.endedAt) s.endedAt = exportTs;
    await putIssueSession(db, s);
  }

  setMsg(`Cierre de día completado (${lines.length} líneas).`, "ok");
}

function hookScannerInput() {
  let buffer = "";
  let timer = null;

  function shouldIgnoreScannerCapture(evtTarget) {
    if (el.manualDialog?.open) return true;

    const active = evtTarget || document.activeElement;
    if (!active) return false;

    if (active === el.scanInput) return false;

    const ownerDialog = active.closest?.("dialog");
    if (ownerDialog?.open) return true;

    if (active.isContentEditable) return true;

    const tag = active.tagName?.toUpperCase?.() || "";
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  function scheduleFlush() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (buffer.trim()) flush();
    }, 90);
  }

  function flush() {
    const value = buffer.trim();
    buffer = "";
    if (el.scanInput) el.scanInput.value = "";
    clearTimeout(timer);
    timer = null;

    if (!value) return;

    handleScan(value).catch((e) => setMsg(e.message, "err"));
  }

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (shouldIgnoreScannerCapture(e.target)) return;

    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      flush();
      return;
    }

    if (e.key === "Backspace") {
      buffer = buffer.slice(0, -1);
      scheduleFlush();
      return;
    }

    if (e.key.length === 1) {
      buffer += e.key;
      scheduleFlush();
    }
  });

  safeOn(el.scanInput, "input", () => {
    if (shouldIgnoreScannerCapture(el.scanInput)) return;
    const v = el.scanInput?.value ?? "";
    if (!v) return;
    buffer = v;
    scheduleFlush();
  });

  safeOn(el.scanInput, "paste", () => {
    if (shouldIgnoreScannerCapture(el.scanInput)) return;
    const v = el.scanInput?.value ?? "";
    if (!v) return;
    buffer = v;
    scheduleFlush();
  });
}

function bindEvents() {
  safeOn(el.btnStart, "click", () => startSession().catch((e) => setMsg(e.message, "err")));
  safeOn(el.btnFinish, "click", () => finishSession().catch((e) => setMsg(e.message, "err")));
  safeOn(el.btnUndo, "click", () => undoLast().catch((e) => setMsg(e.message, "err")));
  safeOn(el.btnDayClose, "click", () => closeDayAndExport().catch((e) => setMsg(e.message, "err")));

  safeOn(el.btnManual, "click", () => {
    el.manualRef.value = "";
    el.manualLote.value = "";
    el.manualSublote.value = "";
    el.manualQty.value = "1";
    el.manualDialog.showModal();
    setTimeout(() => el.manualRef.focus(), 30);
  });

  safeOn(el.btnManualCancel, "click", () => el.manualDialog.close());
  safeOn(el.manualForm, "submit", (evt) => {
    evt.preventDefault();
    const ref = norm(el.manualRef.value);
    if (!ref) {
      setMsg("La referencia es obligatoria.", "err");
      return;
    }

    const sublote = norm(el.manualSublote.value) || null;
    const qtyRaw = Math.max(1, Number(el.manualQty.value || 1));
    const qty = sublote ? 1 : qtyRaw;

    addLineFromData({
      ref,
      lote: norm(el.manualLote.value) || null,
      sublote,
    }, qty)
      .then(() => el.manualDialog.close())
      .catch((e) => setMsg(e.message, "err"));
  });
}

async function init() {
  db = await openDb();
  setEnabledForOperation(false);
  bindEvents();
  hookScannerInput();
  await refreshSessionLines();
}

init().catch((e) => {
  console.error(e);
  setMsg(`Error iniciando: ${e.message}`, "err");
});
