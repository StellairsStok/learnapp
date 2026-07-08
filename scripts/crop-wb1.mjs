// 裁图:按 tmp/wb1-final-plan.json 从页图裁出每道题 → content/questions/img/q-wb1-pNNN-NN.webp
// 覆盖跨栏/跨页续题:若下一题不在本题末端的"自然下一位置"顶端,则把中间的续段竖向拼接进本题。
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const FINAL = JSON.parse(fs.readFileSync(path.join(ROOT, "tmp", "wb1-final-plan.json"), "utf8"));
const PAGES_DIR = path.join(ROOT, "tmp", "wb1-pages");
const OUT_DIR = path.join(ROOT, "content", "questions", "img");

const pad = (n, l = 3) => String(n).padStart(l, "0");
const pageFile = (wbPage) => path.join(PAGES_DIR, `wb1-60-${pad(wbPage + 4, 2)}.png`);

// 版式常量(2650×3855 实测):内容区 y∈[240,3745];L 栏 x∈[70,1345],R 栏 x∈[1305,2600]
const TOP = 240, BOTTOM = 3745;
const COLS = { L: { x0: 70, x1: 1345 }, R: { x0: 1305, x1: 2600 } };
const PAD_ABOVE = 55, PAD_BELOW = 18;

// 把所有题按全书阅读顺序排平:页→L栏→R栏、栏内按 y
const flat = [];
for (const p of FINAL.pages) {
  if (!p.questions?.length) continue;
  for (const q of p.questions) {
    if (q.y == null) throw new Error(`p${pad(p.wbPage)} ${q.column}${q.n} 未定位,先解决 MANUAL 项再裁图`);
    flat.push({ ...q, wbPage: p.wbPage, printedPage: p.printedPage });
  }
}
flat.sort((a, b) => a.wbPage - b.wbPage || (a.column === b.column ? a.y - b.y : a.column === "L" ? -1 : 1));

// 每题的"本段"与可能的续段(下一题起点之前的空隙)
function segmentsOf(idx) {
  const cur = flat[idx];
  const next = flat[idx + 1] ?? null;
  const segs = [];
  const col = COLS[cur.column];
  const y0 = Math.max(TOP, cur.y - PAD_ABOVE);

  if (next && next.wbPage === cur.wbPage && next.column === cur.column) {
    segs.push({ wbPage: cur.wbPage, col: cur.column, y0, y1: next.y - PAD_BELOW });
    return segs;
  }
  // 本题是本栏最后一题:先取到栏底
  segs.push({ wbPage: cur.wbPage, col: cur.column, y0, y1: BOTTOM });
  if (!next) return segs;

  // 跨栏续:下一题在同页另一栏、且不是从栏顶开始 → 中间是本题的续段
  if (next.wbPage === cur.wbPage && next.column !== cur.column && next.y > TOP + 320) {
    segs.push({ wbPage: next.wbPage, col: next.column, y0: TOP, y1: next.y - PAD_BELOW });
  }
  // 跨页续:下一题在下一页第一栏、且不是从栏顶开始
  if (next.wbPage === cur.wbPage + 1 && next.column === "L" && next.y > TOP + 320) {
    segs.push({ wbPage: next.wbPage, col: "L", y0: TOP, y1: next.y - PAD_BELOW });
  }
  return segs;
}

const TARGET_W = 1200;

async function cropOne(idx, qid) {
  const segs = segmentsOf(idx);
  const parts = [];
  for (const s of segs) {
    const col = COLS[s.col];
    const h = Math.max(60, Math.round(s.y1 - s.y0));
    const buf = await sharp(pageFile(s.wbPage))
      .extract({ left: col.x0, top: Math.round(s.y0), width: col.x1 - col.x0, height: Math.min(h, 3855 - Math.round(s.y0)) })
      .resize({ width: TARGET_W })
      .png()
      .toBuffer();
    parts.push(buf);
  }
  let img;
  if (parts.length === 1) {
    img = sharp(parts[0]);
  } else {
    // 竖向拼接(段间加 6px 分隔线)
    const metas = await Promise.all(parts.map((b) => sharp(b).metadata()));
    const totalH = metas.reduce((s, m) => s + m.height, 0) + (parts.length - 1) * 6;
    img = sharp({ create: { width: TARGET_W, height: totalH, channels: 3, background: { r: 246, g: 246, b: 246 } } });
    const comps = [];
    let y = 0;
    for (let i = 0; i < parts.length; i++) { comps.push({ input: parts[i], top: y, left: 0 }); y += metas[i].height + 6; }
    img = img.composite(comps);
  }
  await img.webp({ quality: 82 }).toFile(path.join(OUT_DIR, `${qid}.webp`));
  return segs;
}

const manifest = [];
const perPageSeq = {};
for (let i = 0; i < flat.length; i++) {
  const q = flat[i];
  const seq = (perPageSeq[q.wbPage] = (perPageSeq[q.wbPage] ?? 0) + 1);
  const qid = `q-wb1-p${pad(q.wbPage)}-${pad(seq, 2)}`;
  const segs = await cropOne(i, qid);
  manifest.push({ qid, wbPage: q.wbPage, printedPage: q.printedPage, n: q.n, column: q.column, y: q.y, segments: segs.length, via: q.via });
  if (i % 40 === 0) console.log(`…${i + 1}/${flat.length}`);
}
fs.writeFileSync(path.join(ROOT, "tmp", "wb1-crop-manifest.json"), JSON.stringify({ count: manifest.length, items: manifest }, null, 2));
console.log(`裁图完成 ${manifest.length} 张(跨段拼接 ${manifest.filter((m) => m.segments > 1).length} 张)`);
