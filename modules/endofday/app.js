import { openDb, getIssueRequestsByDay, clearIssueRequestsByDay } from "../inventario/db.js";

const el = {
  btnRefresh: document.getElementById("btnRefresh"),
  btnExport: document.getElementById("btnExport"),
  btnFinishDay: document.getElementById("btnFinishDay"),
  msg: document.getElementById("msg"),
  tbody: document.getElementById("tbody"),
};

let db;
let rows = [];
const dayKey = (ts = Date.now()) => new Date(ts).toISOString().slice(0, 10);
const hour = (ts) => new Date(ts).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function setMsg(text = "", kind = "") {
  el.msg.textContent = text;
  el.msg.className = `msg ${kind}`;
}

async function loadRows() {
  const today = dayKey();
  rows = await getIssueRequestsByDay(db, today);
  rows.sort((a, b) => `${a.ceco}|${a.operario}|${hour(a.createdAt)}`.localeCompare(`${b.ceco}|${b.operario}|${hour(b.createdAt)}`));

  el.tbody.innerHTML = rows.map((r) => `
    <tr>
      <td>${r.requestRef}</td>
      <td>${r.dayKey}</td>
      <td>${hour(r.createdAt)}</td>
      <td>${r.ceco}</td>
      <td>${r.operario}</td>
      <td>${r.ref}</td>
      <td>${r.lote ?? ""}</td>
      <td>${r.sublote ?? ""}</td>
      <td>${r.cantidad}</td>
    </tr>
  `).join("");
}

function exportCsv(matrix, filename) {
  const csv = matrix.map((row) => row.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(";")).join("\n");
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

function exportRows() {
  if (!rows.length) return setMsg("No hay registros para exportar.", "err");
  const head = ["REQUEST_REF","FECHA","HORA","CECO","OPERARIO","REFERENCIA","LOTE","SUBLOTE","CANTIDAD"];
  const data = rows.map((r) => [r.requestRef, r.dayKey, hour(r.createdAt), r.ceco, r.operario, r.ref, r.lote || "", r.sublote || "", r.cantidad]);
  const matrix = [head, ...data];

  if (window.XLSX) {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(matrix);
    XLSX.utils.book_append_sheet(wb, ws, "EndOfDay");
    XLSX.writeFile(wb, `endofday_${dayKey()}.xlsx`);
  } else {
    exportCsv(matrix, `endofday_${dayKey()}.csv`);
  }
  setMsg("Exportación generada.", "ok");
}

async function finishDay() {
  if (!rows.length) return setMsg("No hay datos para FIN DE DIA.", "err");
  if (!window.confirm("FIN DE DIA borrará las solicitudes consolidadas del día. ¿Continuar?")) return;
  await clearIssueRequestsByDay(db, dayKey());
  await loadRows();
  setMsg("FIN DE DIA completado. Datos del día limpiados.", "warn");
}

async function init() {
  db = await openDb();
  await loadRows();
  el.btnRefresh.addEventListener("click", () => loadRows().catch((e) => setMsg(e.message, "err")));
  el.btnExport.addEventListener("click", () => exportRows());
  el.btnFinishDay.addEventListener("click", () => finishDay().catch((e) => setMsg(e.message, "err")));
}

init().catch((e) => {
  console.error(e);
  setMsg(`Error iniciando: ${e.message}`, "err");
});
