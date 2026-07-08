// 对账:视觉核对的题号地面真值(tmp/wb1-vision.json) × OCR 计划的坐标(tmp/wb1-question-plan.json)
// → 每题定位(页/栏/y/题号),产出最终裁图计划 tmp/wb1-final-plan.json。
// 匹配不上坐标的题走三级恢复:放宽 OCR 行搜索 → 图像通道候选 → 标记人工。
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const PLAN = JSON.parse(fs.readFileSync(path.join(ROOT, "tmp", "wb1-question-plan.json"), "utf8"));
const VISION = JSON.parse(fs.readFileSync(path.join(ROOT, "tmp", "wb1-vision.json"), "utf8"));
const OCR = JSON.parse(fs.readFileSync(path.join(ROOT, "tmp", "wb1-ocr.json"), "utf8"));
const DET = JSON.parse(fs.readFileSync(path.join(ROOT, "tmp", "wb1-detect.json"), "utf8"));

const pad = (n, l = 3) => String(n).padStart(l, "0");

// 放宽版行搜索:在指定页/栏/y 区间里找行首为数字 n 的 OCR 行(不做严格过滤)
function looseFind(wbPage, col, n, yLo, yHi, used) {
  const page = OCR.pages.find((p) => p.wbPage === wbPage);
  const det = DET.pages.find((p) => p.wbPage === wbPage);
  const W = det?.width ?? 2650;
  if (!page) return null;
  for (const line of page.lines ?? []) {
    const words = (line.words ?? []).slice().sort((a, b) => a.x - b.x);
    const w = words[0];
    if (!w) continue;
    const d = String(w.text ?? "").replace(/[^\d]/g, "");
    if (d !== String(n)) continue;
    const inCol = col === "L" ? w.x < W * 0.5 : w.x >= W * 0.42;
    if (!inCol) continue;
    if (w.y < yLo || w.y > yHi) continue;
    const key = `${col}:${Math.round(w.y)}`;
    if (used.has(key)) continue;
    return { y: w.y, x: w.x, via: "loose-ocr" };
  }
  return null;
}

// 图像通道候选:该页该栏、y 区间内、还没被占用的 start
function imageCandidate(wbPage, col, yLo, yHi, used) {
  const det = DET.pages.find((p) => p.wbPage === wbPage);
  for (const s of det?.starts ?? []) {
    if (s.column !== col) continue;
    if (s.y < yLo || s.y > yHi) continue;
    const key = `${col}:${Math.round(s.y)}`;
    if (used.has(key)) continue;
    return { y: s.y, x: s.x, via: "image" };
  }
  return null;
}

const outPages = [];
let manual = 0, recovered = 0, dropped = 0, matched = 0;

for (const v of VISION.pages.sort((a, b) => a.wbPage - b.wbPage)) {
  const planPage = PLAN.pages.find((p) => p.wbPage === v.wbPage);
  const entry = {
    wbPage: v.wbPage,
    printedPage: v.wbPage - 3,
    pageKind: v.pageKind,
    sectionHeader: v.sectionHeader,
    notes: v.notes,
    questions: [],
  };
  if (v.pageKind === "答案页" || v.pageKind === "目录或说明页") { outPages.push(entry); continue; }

  const used = new Set();
  for (const col of ["L", "R"]) {
    const expected = col === "L" ? v.columnsL : v.columnsR;
    const ocrStarts = (planPage?.starts ?? []).filter((s) => s.column === col).sort((a, b) => a.y - b.y);
    let prevY = 200;
    for (let i = 0; i < expected.length; i++) {
      const n = expected[i];
      // 1) 精确:OCR 计划里同栏同号、y 在 prevY 之后的第一个
      let hit = ocrStarts.find((s) => s.n === n && s.y > prevY - 30 && !used.has(`${col}:${Math.round(s.y)}`));
      let via = "plan";
      const yHi = 3790;
      if (!hit) { const r = looseFind(v.wbPage, col, n, prevY - 30, yHi, used); if (r) { hit = r; via = r.via; recovered++; } }
      if (!hit) { const r = imageCandidate(v.wbPage, col, prevY + 60, yHi, used); if (r) { hit = r; via = r.via; recovered++; } }
      if (hit) {
        used.add(`${col}:${Math.round(hit.y)}`);
        if (via === "plan") matched++;
        entry.questions.push({ n, column: col, y: Math.round(hit.y), via });
        prevY = hit.y;
      } else {
        manual++;
        entry.questions.push({ n, column: col, y: null, via: "MANUAL" });
      }
    }
    // 统计:OCR 计划里这栏没被视觉名单收留的 start = 假阳性,丢弃
    dropped += ocrStarts.filter((s) => !used.has(`${col}:${Math.round(s.y)}`)).length;
  }
  outPages.push(entry);
}

const totalQ = outPages.reduce((s, p) => s + p.questions.length, 0);
fs.writeFileSync(path.join(ROOT, "tmp", "wb1-final-plan.json"), JSON.stringify({ generatedAt: new Date().toISOString(), totalQ, matched, recovered, manual, droppedFalsePositives: dropped, pages: outPages }, null, 2));
console.log(`总题数=${totalQ} 精确匹配=${matched} 三级恢复=${recovered} 需人工=${manual} 丢弃假阳性=${dropped}`);
for (const p of outPages) {
  const man = p.questions.filter((q) => q.y == null);
  if (man.length) console.log(`  ⚠ p${pad(p.wbPage)} 需人工定位: ${man.map((q) => q.column + q.n).join(", ")}`);
}
