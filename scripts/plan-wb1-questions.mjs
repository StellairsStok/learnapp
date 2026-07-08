import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const OCR = JSON.parse(fs.readFileSync(path.join(ROOT, "tmp", "wb1-ocr.json"), "utf8"));
const DET = JSON.parse(fs.readFileSync(path.join(ROOT, "tmp", "wb1-detect.json"), "utf8"));
const OUT = path.join(ROOT, "tmp", "wb1-question-plan.json");

function pad(n, len = 3) {
  return String(n).padStart(len, "0");
}

function logicalToPrinted(wbPage) {
  return wbPage >= 4 ? wbPage - 3 : null;
}

function columnOfX(x, w) {
  if (x > w * 0.035 && x < w * 0.13) return "L";
  if (x > w * 0.455 && x < w * 0.56) return "R";
  return null;
}

function isLikelyNumberWord(t) {
  const s = String(t ?? "").replace(/[^\d]/g, "");
  return /^\d{1,2}$/.test(s) && Number(s) >= 1 && Number(s) <= 30;
}

// 补丁B:换行续行以"数字+单位"开头会被误判为题号(实测19处,如"10 cm,则有")
const UNIT_AFTER_NUM = /^(cm|mm|m\b|g\b|kg|s\b|min|h\b|Pa|kPa|atm|J\b|kJ|W\b|N\b|K\b|mol|L\b|mL|eV|V\b|A\b|℃|%|cmHg|倍|分\b|次|个)/i;

function collectStarts(page) {
  if (page.wbPage <= 3) return [];
  const detPage = DET.pages.find((p) => p.wbPage === page.wbPage);
  const imgW = detPage?.width ?? 2650;
  const starts = [];

  for (const line of page.lines) {
    const lineText = String(line.text ?? "").trim();
    if (/题\s*型|课\s*时|考\s*点|答\s*案|第\s*[一二三四五六七八九十]/.test(lineText)) continue;
    if (/每小题|共\s*\d+\s*分/.test(lineText)) continue; // 补丁B:节头"共18分.在每小题…"换行
    if (/^[（(]/.test(lineText)) continue;
    const words = (line.words ?? []).slice().sort((a, b) => a.x - b.x);
    for (const [idx, word] of words.entries()) {
      if (idx > 0) break;
      if (!isLikelyNumberWord(word.text)) continue;
      const col = columnOfX(word.x, imgW);
      if (!col) continue;
      if (word.y < 240 || word.y > 3720) continue;
      const n = Number(String(word.text).replace(/[^\d]/g, ""));
      // 补丁A:印刷页码独占一行、位于页底(实测6页,如 p015 底部"2")
      if (lineText.replace(/\s/g, "") === String(word.text).replace(/\s/g, "") && word.y > 3600) continue;
      // 补丁B:题号后紧跟单位的是物理量换行,不是题号
      const rest = lineText.replace(/^\S+\s*/, "");
      if (UNIT_AFTER_NUM.test(rest)) continue;
      // 补丁B2(窄):科学计数法/小数换行会拆成"6."+"0×10²³…"——拒绝 0 开头或 ×10 型续行;
      // 不做"必须汉字开头"的宽规则,避免误伤"2023年…"这类年份开头的真题干。
      const restClean = rest.replace(/^[.。,,·、::;;]+\s*/, "");
      if (/^0/.test(restClean) || /^[\d.\s]*[×xX]\s*10/.test(restClean) || /^[=≈+\-±]/.test(restClean)) continue;
      starts.push({ column: col, x: word.x, y: word.y, n, source: "ocr", text: line.text });
    }
  }

  for (const s of detPage?.starts ?? []) {
    if (s.score < 520) continue;
    if (s.y < 240 || s.y > 3720) continue;
    starts.push({ column: s.column, x: s.x, y: s.y, n: null, source: "image", text: "" });
  }

  starts.sort((a, b) => (a.column === b.column ? a.y - b.y : a.column.localeCompare(b.column)));
  const merged = [];
  for (const s of starts) {
    const near = merged.find((m) => m.column === s.column && Math.abs(m.y - s.y) < 52);
    if (near) {
      if (s.source === "ocr" && near.source !== "ocr") Object.assign(near, s);
      continue;
    }
    merged.push({ ...s });
  }

  const cleaned = [];
  for (const col of ["L", "R"]) {
    const arr = merged.filter((s) => s.column === col).sort((a, b) => a.y - b.y);
    for (let i = 0; i < arr.length; i++) {
      const cur = arr[i];
      const next = arr[i + 1];
      if (next && next.y - cur.y < 135 && cur.source === "image" && next.source === "ocr") continue;
      if (next && next.y - cur.y < 110 && cur.text === "" && next.text !== "") continue;
      if (cur.text && /[ABCDabcd]\s*[\.·]/.test(cur.text.slice(0, 6))) continue;
      cleaned.push(cur);
    }
  }
  cleaned.sort((a, b) => {
    if (a.column !== b.column) return a.column === "L" ? -1 : 1;
    return a.y - b.y;
  });
  return cleaned;
}

const pages = OCR.pages.map((page) => {
  const starts = collectStarts(page);
  return {
    wbPage: page.wbPage,
    pdfPage: page.pdfPage,
    printedPage: logicalToPrinted(page.wbPage),
    kind: page.wbPage <= 2 ? "目录页" : page.wbPage === 3 ? "亮点导引" : "内容页",
    count: starts.length,
    starts,
  };
});

// 补丁C:题号连续性校验——跨页连续追踪,遇 1 视为新节重新起号;
// 跳号/乱序输出 warning,裁图前必须人工复核对应页。
const warnings = [];
let prevN = 0;
let prevAt = "";
for (const p of pages) {
  for (const s of p.starts) {
    const at = `p${pad(p.wbPage)}${s.column}y${Math.round(s.y)}`;
    if (s.n == null) {
      warnings.push(`${at}: 图像通道题号未知(裁图后须补 OCR 题号)`);
      continue;
    }
    if (s.n === 1) { prevN = 1; prevAt = at; continue; } // 新节起号
    if (prevN > 0 && s.n !== prevN + 1) {
      warnings.push(`${at}: 题号 ${s.n} 接在 ${prevAt} 的 ${prevN} 之后(跳号/乱序,须人工复核)`);
    }
    prevN = s.n; prevAt = at;
  }
}

const total = pages.reduce((sum, p) => sum + p.count, 0);
fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), total, warnings, pages }, null, 2), "utf8");
for (const p of pages) console.log(`p${pad(p.wbPage)} print=${p.printedPage ?? "-"} ${p.kind} ${p.count}题`);
console.log(`total=${total}`);
console.log(`warnings=${warnings.length}`);
for (const w of warnings) console.log("  ⚠ " + w);
