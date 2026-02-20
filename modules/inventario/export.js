export function exportToXlsx(lines) {
  // Requiere que XLSX (SheetJS) esté cargado en window
  if (!window.XLSX) throw new Error("SheetJS (XLSX) no está cargado.");

  const rows = lines.map(l => ({
    UBICACION: l.ubicacion,
    REF_ARTICULO: l.ref,
    LOTE: l.lote ?? "",
    SUBLOTE: l.sublote ?? "",
    CANTIDAD: l.cantidad
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Inventario");

  const filename = `inventario_${new Date().toISOString().slice(0,10)}.xlsx`;
  XLSX.writeFile(wb, filename);
}

export function exportToCsv(lines) {
  const header = ["UBICACION", "REF_ARTICULO", "LOTE", "SUBLOTE", "CANTIDAD"];
  const rows = lines.map((l) => [
    l.ubicacion ?? "",
    l.ref ?? "",
    l.lote ?? "",
    l.sublote ?? "",
    String(l.cantidad ?? 0),
  ]);

  const csv = [header, ...rows]
    .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(";"))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `inventario_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
