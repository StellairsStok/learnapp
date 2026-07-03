// 题图瘦身:PNG → WebP(限宽 1200,质量 88),同步更新 crops.json 的文件名。
// 用法:node scripts/compress-crops.mjs
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const IMG_DIR = path.resolve("content/questions/img");
const MANIFEST = path.resolve("content/questions/crops.json");

const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf-8"));
const qids = manifest.qids ?? manifest;
let done = 0;
let before = 0;
let after = 0;

for (const [qid, meta] of Object.entries(qids)) {
  const src = path.join(IMG_DIR, meta.file);
  if (!fs.existsSync(src) || !meta.file.endsWith(".png")) continue;
  const out = path.join(IMG_DIR, `${qid}.webp`);
  before += fs.statSync(src).size;
  await sharp(src).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 88 }).toFile(out);
  after += fs.statSync(out).size;
  fs.unlinkSync(src);
  meta.file = `${qid}.webp`;
  done++;
}

fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1), "utf-8");
console.log(`compressed ${done} images: ${(before / 1048576).toFixed(1)}MB → ${(after / 1048576).toFixed(1)}MB`);
