// 从 .DOC 二进制里雕取嵌入图片(JPEG/PNG 签名扫描),按出现顺序编号。
// 用法:node scripts/carve-doc-images.mjs <doc路径> <输出目录>
import fs from "node:fs";
import path from "node:path";

const [, , docPath, outDir] = process.argv;
if (!docPath || !outDir) { console.error("用法:node carve-doc-images.mjs <doc> <outdir>"); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });

const buf = fs.readFileSync(docPath);
console.log("读入", Math.round(buf.length / 1048576), "MB,开始扫描…");

const out = [];
let i = 0;
const MIN_SIZE = 3000; // 过滤图标级小图
while (i < buf.length - 8) {
  // PNG: 89 50 4E 47 0D 0A 1A 0A … IEND AE 42 60 82
  if (buf[i] === 0x89 && buf[i + 1] === 0x50 && buf[i + 2] === 0x4e && buf[i + 3] === 0x47 && buf[i + 4] === 0x0d && buf[i + 5] === 0x0a && buf[i + 6] === 0x1a && buf[i + 7] === 0x0a) {
    const end = buf.indexOf(Buffer.from([0x49, 0x45, 0x4e, 0x44]), i + 8);
    if (end > 0) {
      const stop = end + 8; // IEND + CRC
      const img = buf.subarray(i, stop);
      if (img.length >= MIN_SIZE) out.push({ offset: i, type: "png", data: img });
      i = stop; continue;
    }
  }
  // JPEG: FF D8 FF … FF D9
  if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i + 2] === 0xff) {
    const end = buf.indexOf(Buffer.from([0xff, 0xd9]), i + 3);
    if (end > 0 && end - i < 20 * 1048576) {
      const img = buf.subarray(i, end + 2);
      if (img.length >= MIN_SIZE) out.push({ offset: i, type: "jpg", data: img });
      i = end + 2; continue;
    }
  }
  i++;
}

console.log("找到图片:", out.length);
const manifest = [];
out.forEach((im, idx) => {
  const name = `img-${String(idx + 1).padStart(4, "0")}.${im.type}`;
  fs.writeFileSync(path.join(outDir, name), im.data);
  manifest.push({ n: idx + 1, file: name, type: im.type, bytes: im.data.length, offset: im.offset });
});
fs.writeFileSync(path.join(outDir, "carve-manifest.json"), JSON.stringify(manifest, null, 1));
const mb = out.reduce((s, x) => s + x.data.length, 0) / 1048576;
console.log(`已写 ${out.length} 张(共 ${mb.toFixed(1)}MB)→ ${outDir}`);
console.log("尺寸分布: <20KB:", manifest.filter((m) => m.bytes < 20480).length, " 20-100KB:", manifest.filter((m) => m.bytes >= 20480 && m.bytes < 102400).length, " >100KB:", manifest.filter((m) => m.bytes >= 102400).length);
