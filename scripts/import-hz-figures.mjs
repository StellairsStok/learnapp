// 把视觉筛选入选的学案图转 webp 并入 content/figures/(id=fig-hz-NNNN),合并 manifest。幂等。
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const SCRATCH = "C:/Users/chenz/AppData/Local/Temp/claude/C--Users-chenz-Desktop-learnapp/6c64fa0a-47b0-435a-aa18-7d3726a4a82a/scratchpad";
const kept = JSON.parse(fs.readFileSync(path.join(SCRATCH, "hz-curated.json"), "utf8"));
const CARVE = path.join(SCRATCH, "hz-carve");
const OUT = "content/figures";
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8"));

// 树校验:kps 只保留真实存在的 id
const tree = JSON.parse(fs.readFileSync("content/tree/kp-tree.json", "utf8"));
const kpIds = new Set();
for (const ch of tree.chapters) for (const u of ch.units) for (const k of u.kps) kpIds.add(k.id);

// 去掉旧的 hz 条目(幂等重跑)
manifest.figures = manifest.figures.filter((f) => !f.id.startsWith("fig-hz-"));

let ok = 0, skippedNoKp = 0, tooSmall = 0;
for (const it of kept) {
  const fname = path.basename(String(it.file).replace(/\\/g, "/"));
  const n = fname.match(/img-(\d+)/)[1];
  const id = `fig-hz-${n}`;
  const src = path.join(CARVE, fname);
  if (!fs.existsSync(src)) { console.log("缺源图:", it.file); continue; }
  const kps = (it.kps || []).filter((k) => kpIds.has(k));
  if (kps.length === 0) { skippedNoKp++; continue; }
  const meta = await sharp(src).metadata();
  if (meta.width < 260 || meta.height < 120) { tooSmall++; continue; } // 太小的装饰图兜底过滤
  const img = sharp(src);
  if (meta.width > 1200) img.resize({ width: 1200 });
  await img.webp({ quality: 84 }).toFile(path.join(OUT, `${id}.webp`));
  manifest.figures.push({
    id,
    file: `${id}.webp`,
    caption: it.caption || it.content,
    kps,
    keywords: (it.keywords || []).slice(0, 6),
  });
  ok++;
}
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`入库 ${ok} 张(kp无效跳过 ${skippedNoKp},过小跳过 ${tooSmall});manifest 现共 ${manifest.figures.length} 张`);
// 每考点配图数 TOP
const byKp = {};
for (const f of manifest.figures) for (const k of f.kps) byKp[k] = (byKp[k] || 0) + 1;
console.log("配图最多的考点:", Object.entries(byKp).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => k + ":" + v).join("  "));
