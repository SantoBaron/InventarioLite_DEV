// app.js
import { openDb, getAllLines, putLine, deleteLine, clearAll, findByKey } from "./db.js";
import { parseGs1 } from "./gs1.js";
import { exportToCsv, exportToXlsx } from "./export.js";

const STATE = {
  WAIT_LOC: "WAIT_LOC",
  WAIT_ITEMS: "WAIT_ITEMS",
  FINISHED: "FINISHED",
};

const el = {
  scanInput: document.getElementById("scanInput"),
  stateText: document.getElementById("stateText"),
  locText: document.getElementById("locText"),
  lastText: document.getElementById("lastText"),
  countText: document.getElementById("countText"),
  msg: document.getElementById("msg"),
  tbody: document.getElementById("tbody"),
  btnModePda: document.getElementById("btnModePda"),
  btnUndo: document.getElementById("btnUndo"),
  btnNextLoc: document.getElementById("btnNextLoc"),
  btnNextLocCard: document.getElementById("btnNextLocCard"),
  btnFinish: document.getElementById("btnFinish"),
  btnFinishCard: document.getElementById("btnFinishCard"),
  btnManual: document.getElementById("btnManual"),
  btnManualCard: document.getElementById("btnManualCard"),
  btnMenuNext: document.getElementById("btnMenuNext"),
  btnMenuFinish: document.getElementById("btnMenuFinish"),
  btnMenuManual: document.getElementById("btnMenuManual"),
  btnMenuUndo: document.getElementById("btnMenuUndo"),
  btnMenuExport: document.getElementById("btnMenuExport"),
  btnMenuExportCsv: document.getElementById("btnMenuExportCsv"),
  btnMenuReset: document.getElementById("btnMenuReset"),
  manualDialog: document.getElementById("manualDialog"),
  manualForm: document.getElementById("manualForm"),
  manualRef: document.getElementById("manualRef"),
  manualLote: document.getElementById("manualLote"),
  manualSublote: document.getElementById("manualSublote"),
  manualQty: document.getElementById("manualQty"),
  manualPrint: document.getElementById("manualPrint"),
  manualHint: document.getElementById("manualHint"),
  btnManualCancel: document.getElementById("btnManualCancel"),
  btnExport: document.getElementById("btnExport"),
  btnExportCsv: document.getElementById("btnExportCsv"),
  btnReset: document.getElementById("btnReset"),
};

let db;
let appState = STATE.WAIT_LOC;
let currentLoc = null;
let lastInsertedId = null;
let currentLines = [];
let manualMode = "create"; // create | edit
let editingLineId = null;
let pdaMode = false;

function uuid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : String(Date.now()) + "_" + Math.random().toString(16).slice(2);
}

function safeOn(node, evt, fn) {
  if (!node) return;
  node.addEventListener(evt, fn);
}

function safeOnMany(nodes, evt, fn) {
  for (const n of nodes) safeOn(n, evt, fn);
}

function closeDetailsMenuFromEvent(evt) {
  const details = evt?.target?.closest?.("details");
  if (details) details.open = false;
}

function setMsg(text = "", kind = "") {
  if (!el.msg) return;
  el.msg.textContent = text;
  el.msg.className = "msg " + (kind || "");
}

function setState(s) {
  appState = s;
  if (!el.stateText) return;
  if (s === STATE.WAIT_LOC) el.stateText.textContent = "Esperando UBICACIÓN";
  if (s === STATE.WAIT_ITEMS) el.stateText.textContent = "Escaneando ARTÍCULOS";
  if (s === STATE.FINISHED) el.stateText.textContent = "FIN DE INVENTARIO";
}

function norm(s) {
  return (s ?? "").trim();
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function makeKey(ubicacion, ref, lote, sublote) {
  const u = norm(ubicacion).toUpperCase();
  const r = norm(ref).toUpperCase();
  const l = norm(lote || "");
  const sl = norm(sublote || "");
  return `${u}|${r}|${l}|${sl}`;
}

function findLineById(id) {
  return currentLines.find((l) => l.id === id) || null;
}

function renderTable(lines) {
  if (!el.tbody) return;
  el.tbody.innerHTML = "";

  for (const l of lines) {
    const tr = document.createElement("tr");
    if (l.manual) {
      tr.classList.add("manual-row");
      tr.title = "Registro introducido manualmente";
    }

    tr.innerHTML = `
      <td class="mono">${escapeHtml(l.ubicacion)}</td>
      <td class="mono">${escapeHtml(l.ref)}</td>
      <td class="mono">${escapeHtml(l.lote ?? "")}</td>
      <td class="mono">${escapeHtml(l.sublote ?? "")}</td>
      <td class="num mono">${l.cantidad}</td>
      <td class="actions-cell">
        <div class="row-actions-desktop">
          <button class="mini secondary" data-action="edit" data-id="${escapeHtml(l.id)}">Editar</button>
          <button class="mini warn" data-action="label" data-id="${escapeHtml(l.id)}">Etiqueta</button>
          <button class="mini danger" data-action="delete" data-id="${escapeHtml(l.id)}">Borrar</button>
        </div>
        <details class="row-actions-mobile">
          <summary class="mini secondary row-actions-trigger" title="Acciones">✏️</summary>
          <div class="row-actions-pop">
            <button class="mini secondary" data-action="edit" data-id="${escapeHtml(l.id)}" type="button">Editar</button>
            <button class="mini warn" data-action="label" data-id="${escapeHtml(l.id)}" type="button">Etiqueta</button>
            <button class="mini danger" data-action="delete" data-id="${escapeHtml(l.id)}" type="button">Borrar</button>
          </div>
        </details>
      </td>
    `;
    el.tbody.appendChild(tr);
  }

  if (el.countText) el.countText.textContent = String(lines.length);
}

async function refresh() {
  if (!db) return;
  currentLines = await getAllLines(db);
  renderTable(currentLines);
}

function parseCommand(raw) {
  const s = norm(raw).toUpperCase();
  if (s === "FIN" || s === "FIN DE INVENTARIO") return { cmd: "FIN" };
  if (s === "SIGUIENTE" || s === "FIN UBI" || s === "FIN UBICACION") return { cmd: "NEXT_LOC" };
  if (s === "PDA" || s === "MODO PDA") return { cmd: "PDA_TOGGLE" };
  if (s === "PDA ON" || s === "MODO PDA ON") return { cmd: "PDA_ON" };
  if (s === "PDA OFF" || s === "MODO PDA OFF") return { cmd: "PDA_OFF" };
  if (s.startsWith("LOC:") || s.startsWith("UBI:")) return { cmd: "LOC", loc: raw.slice(4).trim() };
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

  if (pdaMode) {
    // Algunos lectores PDA convierten separadores GS1 en carácter de reemplazo (�)
    s = s.replaceAll("\uFFFD", "Ê");
    s = s.replace(/[\x00-\x1F]/g, "Ê");
    s = s.replace(/Ê+/g, "Ê");
  }

  return s;
}

function updatePdaModeUi() {
  if (!el.btnModePda) return;
  el.btnModePda.textContent = `Modo PDA: ${pdaMode ? "ON" : "OFF"}`;
  el.btnModePda.classList.toggle("active", pdaMode);
  document.body.classList.toggle("pda-mode", pdaMode);
}

function setPdaMode(enabled) {
  pdaMode = Boolean(enabled);
  updatePdaModeUi();
  try {
    localStorage.setItem("inventario_pda_mode", pdaMode ? "1" : "0");
  } catch (_) {}
}

function buildGs1Payload({ ref, lote, sublote }) {
  const parts = [`02${norm(ref)}`];
  if (norm(lote)) parts.push(`10${norm(lote)}`);
  if (norm(sublote)) parts.push(`04${norm(sublote)}`);
  parts.push("21");
  return parts.join(String.fromCharCode(29));
}

function buildGs1Human({ ref, lote, sublote }) {
  const parts = [`02${norm(ref)}`];
  if (norm(lote)) parts.push(`10${norm(lote)}`);
  if (norm(sublote)) parts.push(`04${norm(sublote)}`);
  parts.push("21");
  return parts.join("Ê");
}

async function registerLocation(locRaw) {
  const loc = norm(locRaw);
  if (!loc) {
    setMsg("Ubicación vacía. Vuelve a escanear.", "err");
    return;
  }
  currentLoc = loc;
  if (el.locText) el.locText.textContent = currentLoc;
  setState(STATE.WAIT_ITEMS);
  setMsg(`Ubicación fijada: ${currentLoc}. Escanea artículos…`, "ok");
}

async function finishInventory() {
  if (appState === STATE.FINISHED) {
    setMsg("El inventario ya está finalizado.", "warn");
    return;
  }
  setState(STATE.FINISHED);
  currentLoc = null;
  if (el.locText) el.locText.textContent = "—";
  setMsg("Inventario finalizado. Puedes exportar a Excel o CSV.", "warn");
}

async function closeCurrentLocation() {
  if (!currentLoc) {
    setMsg("No hay ubicación activa para cerrar.", "warn");
    return;
  }
  currentLoc = null;
  if (el.locText) el.locText.textContent = "—";
  setState(STATE.WAIT_LOC);
  setMsg("Ubicación cerrada. Escanea la siguiente ubicación.", "warn");
}

async function storeItem({ ref, lote, sublote, manual = false, cantidad = 1 }) {
  if (!currentLoc) {
    setMsg("No hay ubicación activa. Escanea ubicación primero.", "err");
    setState(STATE.WAIT_LOC);
    return null;
  }

  const key = makeKey(currentLoc, ref, lote, sublote);
  const existing = await findByKey(db, key);

  if (sublote) {
    if (existing.length > 0) {
      setMsg(`DUPLICADO (con sublote) rechazado: ${ref} / ${lote ?? "-"} / ${sublote}`, "err");
      return null;
    }
    const line = {
      id: uuid(),
      key,
      ubicacion: currentLoc,
      ref,
      lote: lote ?? null,
      sublote: sublote ?? null,
      cantidad,
      manual,
      createdAt: Date.now(),
    };
    await putLine(db, line);
    lastInsertedId = line.id;
    setMsg(`OK: ${ref} (lote ${lote ?? "-"}) (sublote ${sublote})${manual ? " [manual]" : ""}`, "ok");
    return line;
  }

  if (existing.length > 0) {
    const line = existing[0];
    line.cantidad += cantidad;
    line.createdAt = Date.now();
    line.manual = Boolean(line.manual || manual);
    await putLine(db, line);
    lastInsertedId = line.id;
    setMsg(`OK (agregado): ${ref} (lote ${lote ?? "-"}) → cantidad ${line.cantidad}${manual ? " [manual]" : ""}`, "ok");
    return line;
  }

  const line = {
    id: uuid(),
    key,
    ubicacion: currentLoc,
    ref,
    lote: lote ?? null,
    sublote: null,
    cantidad,
    manual,
    createdAt: Date.now(),
  };
  await putLine(db, line);
  lastInsertedId = line.id;
  setMsg(`OK: ${ref} (lote ${lote ?? "-"})${manual ? " [manual]" : ""}`, "ok");
  return line;
}

async function registerItem(scanRaw) {
  const raw = norm(scanRaw);
  if (!raw) return;

  const cmd = parseCommand(raw);
  if (cmd?.cmd === "LOC") return registerLocation(cmd.loc);
  if (cmd?.cmd === "FIN") return finishInventory();
  if (cmd?.cmd === "NEXT_LOC") return closeCurrentLocation();

  if (!currentLoc) {
    setMsg("No hay ubicación activa. Escanea ubicación primero.", "err");
    setState(STATE.WAIT_LOC);
    return;
  }

  let ref;
  let lote;
  let sublote;
  const gs1 = parseGs1(raw);

  if (gs1) {
    ref = gs1.ref;
    lote = gs1.lote;
    sublote = gs1.sublote;
  } else {
    ref = raw;
    lote = null;
    sublote = null;
  }

  return storeItem({ ref, lote, sublote, manual: false });
}

function openManualDialogForCreate() {
  if (!currentLoc) {
    setMsg("Primero debes fijar una ubicación para el alta manual.", "warn");
    return;
  }

  manualMode = "create";
  editingLineId = null;

  if (el.manualHint) {
    el.manualHint.textContent = "Usa esta opción cuando el código GS1 no se haya podido leer.";
  }

  if (!el.manualDialog?.showModal) {
    const ref = norm(window.prompt("Referencia:", ""));
    if (!ref) return;
    const lote = norm(window.prompt("Lote (opcional):", "")) || null;
    const sublote = norm(window.prompt("Sublote (opcional):", "")) || null;
    storeItem({ ref, lote, sublote, manual: true })
      .then(refresh)
      .catch((e) => {
        console.error(e);
        setMsg("ERROR: " + (e?.message || e), "err");
      });
    return;
  }

  el.manualRef.value = "";
  el.manualLote.value = "";
  el.manualSublote.value = "";
  if (el.manualQty) el.manualQty.value = "1";
  if (el.manualPrint) el.manualPrint.checked = true;
  el.manualDialog?.showModal?.();
  el.manualRef?.focus?.();
}

function openManualDialogForEdit(line) {
  manualMode = "edit";
  editingLineId = line.id;

  if (el.manualHint) {
    el.manualHint.textContent = "Modifica la línea y guarda los cambios.";
  }

  el.manualRef.value = line.ref ?? "";
  el.manualLote.value = line.lote ?? "";
  el.manualSublote.value = line.sublote ?? "";
  if (el.manualQty) el.manualQty.value = String(line.cantidad ?? 1);
  if (el.manualPrint) el.manualPrint.checked = false;

  el.manualDialog?.showModal?.();
  el.manualRef?.focus?.();
}

async function upsertEditedLine(line, { ref, lote, sublote, cantidad }) {
  const newKey = makeKey(line.ubicacion, ref, lote, sublote);
  const sameKey = newKey === line.key;

  if (sameKey) {
    line.ref = ref;
    line.lote = lote;
    line.sublote = sublote;
    line.cantidad = cantidad;
    line.key = newKey;
    line.manual = true;
    line.createdAt = Date.now();
    await putLine(db, line);
    setMsg("Línea actualizada correctamente.", "ok");
    return line;
  }

  const matches = await findByKey(db, newKey);
  const conflict = matches.find((x) => x.id !== line.id);

  if (conflict && sublote) {
    setMsg("No se puede guardar: ya existe otra línea con el mismo REF/LOTE/SUBLOTE.", "err");
    return null;
  }

  if (conflict && !sublote) {
    conflict.cantidad += cantidad;
    conflict.manual = true;
    conflict.createdAt = Date.now();
    await putLine(db, conflict);
    await deleteLine(db, line.id);
    setMsg("Línea combinada con una existente al modificar.", "warn");
    return conflict;
  }

  line.ref = ref;
  line.lote = lote;
  line.sublote = sublote;
  line.cantidad = cantidad;
  line.key = newKey;
  line.manual = true;
  line.createdAt = Date.now();
  await putLine(db, line);
  setMsg("Línea modificada correctamente.", "ok");
  return line;
}

async function submitManualForm(evt) {
  evt.preventDefault();
  const ref = norm(el.manualRef?.value);
  const lote = norm(el.manualLote?.value) || null;
  const sublote = norm(el.manualSublote?.value) || null;
  const cantidad = Math.max(1, Number.parseInt(el.manualQty?.value || "1", 10) || 1);

  if (!ref) {
    setMsg("Referencia obligatoria en alta manual.", "err");
    return;
  }

  let affectedLine = null;

  if (manualMode === "edit" && editingLineId) {
    const originalLine = findLineById(editingLineId);
    if (!originalLine) {
      setMsg("No se encontró la línea a modificar. Recarga e inténtalo de nuevo.", "err");
      return;
    }
    affectedLine = await upsertEditedLine(originalLine, { ref, lote, sublote, cantidad });
  } else {
    affectedLine = await storeItem({ ref, lote, sublote, manual: true, cantidad });
  }

  if (!affectedLine) return;

  el.manualDialog?.close?.();
  await refresh();

  if (manualMode === "create" && el.manualPrint?.checked) {
    printLineLabel(affectedLine);
  }

  manualMode = "create";
  editingLineId = null;
}

function printLineLabel(line) {
  const ref = norm(line.ref);
  const lote = norm(line.lote || "");
  const sublote = norm(line.sublote || "");
  const gs1Human = buildGs1Human({ ref, lote, sublote });
  const gs1Payload = buildGs1Payload({ ref, lote, sublote });

  const popup = window.open("", "_blank", "width=860,height=620");
  if (!popup) {
    setMsg("No se pudo abrir la ventana de impresión (bloqueador de popups).", "warn");
    return;
  }

  const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Etiqueta - ${escapeHtml(ref)}</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; margin: 18px; color: #111; }
    .label { width: 740px; border: 1px solid #bbb; border-radius: 8px; padding: 16px; }
    .top { display: grid; grid-template-columns: 1fr 180px; gap: 14px; align-items: start; }
    .title { font-size: 32px; margin: 0 0 10px; letter-spacing: .5px; }
    .line { font-size: 22px; margin: 4px 0; }
    .code { margin-top: 12px; font-size: 17px; letter-spacing: .3px; }
    .meta { margin-top: 14px; border-collapse: collapse; width: 100%; }
    .meta td { border: 1px solid #ccc; padding: 7px 8px; font-size: 15px; }
    .muted { color: #555; }
    .tools { margin-bottom: 12px; }
    @media print { .tools { display: none; } body { margin: 0; } .label { border: none; width: auto; } }
  </style>
</head>
<body>
  <div class="tools">
    <button onclick="window.print()">Imprimir etiqueta</button>
  </div>
  <div class="label">
    <div class="top">
      <div>
        <h1 class="title">${escapeHtml(ref)}</h1>
        <p class="line">Lote: <b>${escapeHtml(lote || "-")}</b></p>
        <p class="line">Sublote: <b>${escapeHtml(sublote || "-")}</b></p>
        <p class="code">${escapeHtml(gs1Human)}</p>
      </div>
      <canvas id="dm" width="180" height="180" aria-label="Data Matrix"></canvas>
    </div>
    <table class="meta">
      <tr><td class="muted">Ubicación</td><td>${escapeHtml(line.ubicacion || "-")}</td><td class="muted">Cantidad</td><td>${escapeHtml(String(line.cantidad || 1))}</td></tr>
      <tr><td class="muted">Origen</td><td>${line.manual ? "Manual" : "Escáner"}</td><td class="muted">Fecha</td><td>${new Date().toLocaleString("es-ES")}</td></tr>
    </table>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bwip-js@4.5.0/dist/bwip-js-min.js"></script>
  <script>
    (function render(){
      const text = ${JSON.stringify(gs1Payload)};
      if (!window.bwipjs) return;
      bwipjs.toCanvas(document.getElementById('dm'), {
        bcid: 'datamatrix',
        text,
        gs1: true,
        scale: 4,
        parsefnc: true,
        includetext: false,
      });
    })();
  </script>
</body>
</html>`;

  popup.document.open();
  popup.document.write(html);
  popup.document.close();
}

function handleScan(raw) {
  raw = normalizeScannerRaw(raw);
  raw = stripDemoPrefix(raw);
  if (!raw) return;

  if (el.lastText) el.lastText.textContent = raw;

  const cmd = parseCommand(raw);
  if (cmd?.cmd === "PDA_TOGGLE") {
    setPdaMode(!pdaMode);
    setMsg(`Modo lector activo: ${pdaMode ? "PDA integrado" : "Pistola/teclado"}.`, "ok");
    return;
  }
  if (cmd?.cmd === "PDA_ON") {
    setPdaMode(true);
    setMsg("Modo lector activo: PDA integrado.", "ok");
    return;
  }
  if (cmd?.cmd === "PDA_OFF") {
    setPdaMode(false);
    setMsg("Modo lector activo: Pistola/teclado.", "ok");
    return;
  }
  if (cmd?.cmd === "FIN") return finishInventory();
  if (cmd?.cmd === "NEXT_LOC") return closeCurrentLocation();
  if (cmd?.cmd === "LOC") return registerLocation(cmd.loc);

  if (appState === STATE.FINISHED) {
    setState(STATE.WAIT_LOC);
    setMsg("Se reanuda captura: escanea UBICACIÓN.", "warn");
  }

  if (appState === STATE.WAIT_LOC) return registerLocation(raw);
  if (appState === STATE.WAIT_ITEMS) return registerItem(raw);
}

async function undoLast() {
  if (!lastInsertedId) {
    setMsg("Nada que deshacer.", "warn");
    return;
  }
  await deleteLine(db, lastInsertedId);
  setMsg("Undo OK (último registro eliminado).", "ok");
  lastInsertedId = null;
  await refresh();
}

async function doExport() {
  const lines = await getAllLines(db);
  if (!lines.length) {
    setMsg("No hay datos para exportar.", "warn");
    return;
  }
  exportToXlsx(lines);
  setMsg("Exportación generada (.xlsx).", "ok");
}

async function doExportCsv() {
  const lines = await getAllLines(db);
  if (!lines.length) {
    setMsg("No hay datos para exportar.", "warn");
    return;
  }
  exportToCsv(lines);
  setMsg("Exportación generada (.csv).", "ok");
}

async function doReset() {
  await clearAll(db);
  currentLoc = null;
  lastInsertedId = null;
  if (el.locText) el.locText.textContent = "—";
  if (el.lastText) el.lastText.textContent = "—";
  setState(STATE.WAIT_LOC);
  setMsg("Base limpiada. Escanea UBICACIÓN para empezar.", "warn");
  await refresh();
}

async function handleRowAction(evt) {
  const btn = evt.target.closest("button[data-action]");
  if (!btn) return;

  const action = btn.dataset.action;
  const id = btn.dataset.id;
  const line = findLineById(id);

  if (!line) {
    setMsg("No se encontró la línea seleccionada.", "err");
    return;
  }

  if (action === "delete") {
    await deleteLine(db, line.id);
    if (lastInsertedId === line.id) lastInsertedId = null;
    setMsg("Línea eliminada.", "warn");
    await refresh();
    return;
  }

  if (action === "edit") {
    if (!el.manualDialog?.showModal) {
      setMsg("Tu navegador no soporta edición con diálogo. Usa uno actualizado.", "warn");
      return;
    }
    openManualDialogForEdit(line);
    return;
  }

  if (action === "label") {
    printLineLabel(line);
  }
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
    if (ownerDialog && !ownerDialog.open) return false;

    if (active.isContentEditable) return true;

    const tag = active.tagName?.toUpperCase?.() || "";
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  function scheduleFlushByState() {
    if (appState === STATE.FINISHED) return;

    const timeoutMs = appState === STATE.WAIT_LOC ? 250 : 90;

    clearTimeout(timer);
    timer = setTimeout(() => {
      if (buffer.trim()) flush();
    }, timeoutMs);
  }

  function flush() {
    const value = buffer.trim();
    buffer = "";
    if (el.scanInput) el.scanInput.value = "";
    clearTimeout(timer);
    timer = null;

    if (!value) return;

    Promise.resolve(handleScan(value))
      .then(refresh)
      .catch((e) => {
        console.error(e);
        setMsg("ERROR: " + (e?.message || e), "err");
      });
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
      scheduleFlushByState();
      return;
    }

    if (e.key.length === 1) {
      buffer += e.key;
      scheduleFlushByState();
    }
  });

  safeOn(el.scanInput, "input", () => {
    if (shouldIgnoreScannerCapture(el.scanInput)) return;
    const v = el.scanInput?.value ?? "";
    if (!v) return;
    buffer = v;
    scheduleFlushByState();
  });

  safeOn(el.scanInput, "paste", () => {
    if (shouldIgnoreScannerCapture(el.scanInput)) return;
    const v = el.scanInput?.value ?? "";
    if (!v) return;
    buffer = v;
    scheduleFlushByState();
  });

  el.scanInput?.focus?.({ preventScroll: true });
  safeOn(document, "click", () => el.scanInput?.focus?.({ preventScroll: true }));
  safeOn(window, "focus", () => el.scanInput?.focus?.({ preventScroll: true }));
}

async function main() {
  window.addEventListener("error", (e) => {
    const msg = e?.error?.message || e?.message || String(e);
    console.error(e);
    setMsg("ERROR JS: " + msg, "err");
  });
  window.addEventListener("unhandledrejection", (e) => {
    console.error(e);
    setMsg("PROMISE ERROR: " + (e?.reason?.message || e?.reason || e), "err");
  });

  db = await openDb();

  hookScannerInput();

  safeOn(el.btnUndo, "click", async () => { await undoLast(); });
  safeOn(el.btnMenuUndo, "click", async (evt) => { closeDetailsMenuFromEvent(evt); await undoLast(); });
  const onTogglePdaMode = (evt) => {
    evt?.preventDefault?.();
    evt?.stopPropagation?.();
    setPdaMode(!pdaMode);
    setMsg(`Modo lector activo: ${pdaMode ? "PDA integrado" : "Pistola/teclado"}.`, "ok");
  };
  safeOn(el.btnModePda, "click", onTogglePdaMode);
  safeOn(el.btnModePda, "touchend", onTogglePdaMode);

  const onNextLoc = async () => {
    await closeCurrentLocation();
    await refresh();
  };

  const onFinish = async () => {
    await finishInventory();
    await refresh();
  };

  safeOnMany([el.btnNextLoc, el.btnNextLocCard, el.btnMenuNext], "click", (evt) => {
    closeDetailsMenuFromEvent(evt);
    onNextLoc().catch((e) => {
      console.error(e);
      setMsg("ERROR: " + (e?.message || e), "err");
    });
  });
  safeOnMany([el.btnFinish, el.btnFinishCard, el.btnMenuFinish], "click", (evt) => {
    closeDetailsMenuFromEvent(evt);
    onFinish().catch((e) => {
      console.error(e);
      setMsg("ERROR: " + (e?.message || e), "err");
    });
  });
  safeOnMany([el.btnManual, el.btnManualCard, el.btnMenuManual], "click", (evt) => { closeDetailsMenuFromEvent(evt); openManualDialogForCreate(); });
  safeOn(el.manualForm, "submit", (evt) => {
    submitManualForm(evt).catch((e) => {
      console.error(e);
      setMsg("ERROR: " + (e?.message || e), "err");
    });
  });
  safeOn(el.btnManualCancel, "click", () => {
    manualMode = "create";
    editingLineId = null;
    el.manualDialog?.close?.();
  });
  safeOn(el.manualDialog, "close", () => {
    el.scanInput?.focus?.({ preventScroll: true });
  });
  safeOn(el.btnExport, "click", async () => { await doExport(); });
  safeOn(el.btnMenuExport, "click", async (evt) => { closeDetailsMenuFromEvent(evt); await doExport(); });
  safeOn(el.btnExportCsv, "click", async () => { await doExportCsv(); });
  safeOn(el.btnMenuExportCsv, "click", async (evt) => { closeDetailsMenuFromEvent(evt); await doExportCsv(); });
  safeOn(el.btnReset, "click", async () => { await doReset(); });
  safeOn(el.btnMenuReset, "click", async (evt) => { closeDetailsMenuFromEvent(evt); await doReset(); });
  safeOn(el.tbody, "click", (evt) => {
    handleRowAction(evt).catch((e) => {
      console.error(e);
      setMsg("ERROR: " + (e?.message || e), "err");
    });
  });

  try {
    const stored = localStorage.getItem("inventario_pda_mode");
    if (stored != null) pdaMode = stored === "1";
  } catch (_) {}
  updatePdaModeUi();
  setState(STATE.WAIT_LOC);
  setMsg("Listo. Escanea una UBICACIÓN.", "ok");
  await refresh();
}

main().catch((err) => {
  console.error(err);
  setMsg("Error inicializando la app: " + (err?.message || err), "err");
});
