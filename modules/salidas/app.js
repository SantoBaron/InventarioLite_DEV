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

function buildAggKey(sessionId, ceco, ref, lote, caducidad) {
  return [sessionId, ceco, ref || "", lote || "", caducidad || ""].join("|");
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
  if (!currentSession) return;

  const ref = norm(data.ref);
  const lote = norm(data.lote) || null;
  const serial = norm(data.serial || data.sublote) || null;
  const caducidad = norm(data.caducidad) || null;
  const isSerial = Boolean(serial);
  const now = Date.now();

  if (!ref) {
    setMsg("Referencia vacía.", "err");
    return;
  }

  if (!isSerial) {
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
      setMsg(`Acumulado ${ref}. Nueva cantidad: ${candidate.cantidad}.`, "ok");
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
    setMsg(`Registrado ${ref}.`, "ok");
    await refreshSessionLines();
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
    cantidad: qty,
    createdAt: now,
    dayKey: currentSession.dayKey,
    exportedAt: null,
    isSerial: true,
    aggKey: null,
  };

  await putIssueLine(db, line);
  lastAction = { type: "insert", lineId: line.id };
  el.lastRead.textContent = `${ref} [serie ${serial}]`;
  setMsg(`Registrada serie ${serial}.`, "ok");
  await refreshSessionLines();
}

async function onScan(raw) {
  const input = norm(raw);
  if (!input || !currentSession) return;

  const parsed = parseGs1(input);
  if (parsed?.ref) {
    await addLineFromData(parsed, 1);
  } else {
    await addLineFromData({ ref: input }, 1);
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

function bindEvents() {
  el.btnStart.addEventListener("click", () => startSession().catch((e) => setMsg(e.message, "err")));
  el.btnFinish.addEventListener("click", () => finishSession().catch((e) => setMsg(e.message, "err")));
  el.btnUndo.addEventListener("click", () => undoLast().catch((e) => setMsg(e.message, "err")));
  el.btnDayClose.addEventListener("click", () => closeDayAndExport().catch((e) => setMsg(e.message, "err")));

  el.scanInput.addEventListener("keydown", (evt) => {
    if (evt.key !== "Enter") return;
    evt.preventDefault();
    const raw = el.scanInput.value;
    el.scanInput.value = "";
    onScan(raw).catch((e) => setMsg(e.message, "err"));
  });

  el.btnManual.addEventListener("click", () => {
    el.manualRef.value = "";
    el.manualLote.value = "";
    el.manualSublote.value = "";
    el.manualQty.value = "1";
    el.manualDialog.showModal();
    setTimeout(() => el.manualRef.focus(), 30);
  });

  el.btnManualCancel.addEventListener("click", () => el.manualDialog.close());
  el.manualForm.addEventListener("submit", (evt) => {
    evt.preventDefault();
    const ref = norm(el.manualRef.value);
    if (!ref) {
      setMsg("La referencia es obligatoria.", "err");
      return;
    }
    const qty = Math.max(1, Number(el.manualQty.value || 1));
    addLineFromData({
      ref,
      lote: norm(el.manualLote.value) || null,
      sublote: norm(el.manualSublote.value) || null,
    }, qty)
      .then(() => el.manualDialog.close())
      .catch((e) => setMsg(e.message, "err"));
  });
}

async function init() {
  db = await openDb();
  setEnabledForOperation(false);
  bindEvents();
  await refreshSessionLines();
}

init().catch((e) => {
  console.error(e);
  setMsg(`Error iniciando: ${e.message}`, "err");
});
