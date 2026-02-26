function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let i = 0;
  let inQuotes = false;

  while (i < line.length) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cur += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      out.push(cur);
      cur = "";
      i += 1;
      continue;
    }
    cur += ch;
    i += 1;
  }

  out.push(cur);
  return out;
}

export function parseSageCsv(text) {
  const rows = [];
  const lines = String(text ?? "").replace(/^\uFEFF/, "").split(/\r?\n/);
  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;
    rows.push(parseCsvLine(rawLine));
  }

  const baseE = [];
  const baseL = [];
  const baseS = [];

  for (const row of rows) {
    const tag = (row[0] || "").trim().toUpperCase();
    if (tag === "E") baseE.push(row);
    if (tag === "L") baseL.push(row);
    if (tag === "S") {
      while (row.length < 20) row.push("");
      baseS.push(row);
    }
  }

  return { baseE, baseL, baseS };
}

function pctFilled(values) {
  if (!values.length) return 0;
  const filled = values.filter((v) => String(v ?? "").trim() !== "").length;
  return filled / values.length;
}

export function detectSageMeta(baseE, baseL, baseS) {
  const sesNums = [
    ...baseE.map((r) => r[1]).filter(Boolean),
    ...baseL.map((r) => r[1]).filter(Boolean),
    ...baseS.map((r) => r[1]).filter(Boolean),
  ];
  const sageSesNum = sesNums[0] || "";

  const invNums = new Set([
    ...baseL.map((r) => r[2]).filter(Boolean),
    ...baseS.map((r) => r[2]).filter(Boolean),
  ]);

  const locFillRatio = pctFilled(baseS.map((row) => row[12] || ""));
  const sageUsesLoc = locFillRatio >= 0.6;

  const stoSet = new Set(baseS.map((row) => (row[4] || "").trim()).filter(Boolean));
  const stoFcy = [...stoSet][0] || "";

  return {
    sageSesNum,
    invNums,
    sageUsesLoc,
    stoFcy,
  };
}

export function buildSageKey({ stoFcy, itMref, lot, slo, loc, sta, pcu, sageUsesLoc }) {
  const parts = [stoFcy, itMref, lot, slo];
  if (sageUsesLoc) parts.push(loc);
  parts.push(sta, pcu);
  return parts.map((v) => String(v ?? "").trim().toUpperCase()).join("|");
}

export function buildSageIndex(baseS, sageUsesLoc) {
  const index = new Map();
  for (const row of baseS) {
    const key = buildSageKey({
      stoFcy: row[4],
      itMref: row[8],
      lot: row[9],
      slo: row[10],
      loc: row[12],
      sta: row[13],
      pcu: row[14],
      sageUsesLoc,
    });

    if (!index.has(key)) index.set(key, []);
    index.get(key).push(row);
  }
  return index;
}

function csvEscape(value) {
  const s = String(value ?? "");
  return `"${s.replaceAll('"', '""')}"`;
}

export function serializeSageCsv(baseE, baseL, finalS) {
  const all = [...baseE, ...baseL, ...finalS];
  return all.map((row) => row.map(csvEscape).join(",")).join("\r\n") + "\r\n";
}
