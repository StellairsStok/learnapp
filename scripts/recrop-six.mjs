// 重裁 6 张被过裁的题图(原裁切错误地把 4 整页拼在一起)。
// 从 200-DPI 源页 PNG(1654×2339)精确裁出单题区域,resize 到宽 1200,写 webp,并更新 crops.json。
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const SRC = "C:/Users/chenz/AppData/Local/Temp/claude/C--Users-chenz-Desktop-learnapp/6c64fa0a-47b0-435a-aa18-7d3726a4a82a/scratchpad/pages200";
const OUT = path.resolve("content/questions/img");
const MANIFEST = path.resolve("content/questions/crops.json");

// 人工核对源页后确定的裁切边界(200-DPI 源页绝对像素,页高 2339,全宽)
const JOBS = [
  { qid: "q-x3-p035-02", page: 35, y0: 1508, y1: 1880 }, // 变式训练1
  { qid: "q-x3-p005-02", page: 5, y0: 1175, y1: 1940 },  // 变式训练1
  { qid: "q-x3-p009-01", page: 9, y0: 140, y1: 575 },    // 变式训练2(页首)
  { qid: "q-x3-p015-02", page: 15, y0: 1005, y1: 1350 }, // B组第14题(综合)
  { qid: "q-x3-p080-02", page: 80, y0: 1650, y1: 2300 }, // 变式训练1(含装置图)
  { qid: "q-x3-p061-03", page: 61, y0: 1745, y1: 1940 }, // 课后作业第14题(平衡态)
];

const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf-8"));
const qids = manifest.qids ?? manifest;

for (const j of JOBS) {
  const srcFile = path.join(SRC, `p-${String(j.page).padStart(3, "0")}.png`);
  const meta = await sharp(srcFile).metadata();
  const top = Math.max(0, j.y0);
  const height = Math.min(meta.height - top, j.y1 - j.y0);
  const outFile = path.join(OUT, `${j.qid}.webp`);
  await sharp(srcFile)
    .extract({ left: 0, top, width: meta.width, height })
    .resize({ width: 1200, withoutEnlargement: true })
    .webp({ quality: 88 })
    .toFile(outFile + ".tmp");
  fs.renameSync(outFile + ".tmp", outFile);
  // 更新清单:单页,去掉错误的多页拼接
  if (qids[j.qid]) qids[j.qid].pages = [j.page];
  const kb = Math.round(fs.statSync(outFile).size / 1024);
  console.log(`${j.qid} → 单页 p${j.page} [${top}..${top + height}] ${kb}KB`);
}

fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1), "utf-8");
console.log("crops.json 已更新");
