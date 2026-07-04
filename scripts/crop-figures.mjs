// 从练习题题图里裁出"标准概念配图"(F-r、Ep-r、速率分布等曲线——这些图形处处一样,可复用)。
// 每条 box 是相对原图的比例 [left, top, width, height]。裁完请人工看一眼结果再定稿。
// 用法:node scripts/crop-figures.mjs
import sharp from "sharp";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const IMG_DIR = path.join(ROOT, "content", "questions", "img");
const OUT_DIR = path.join(ROOT, "content", "figures");
// 教学页(学案讲解部分)的高清页图,概念图从这里裁最干净
const PAGES_DIR = "C:/Users/chenz/Documents/Codex/2026-07-03/ni-k/tmp/pdfs/pages";
const srcPathOf = (f) => f.page ? path.join(PAGES_DIR, `page-${String(f.page).padStart(3, "0")}.png`) : path.join(IMG_DIR, f.src);

// —— 配图清单 —— box:[left,top,width,height] 占原图比例
const FIGS = [
  {
    id: "fig-fr",
    src: "q-x3-p039-01.webp",
    box: [0.325, 0.28, 0.30, 0.31],
    caption: "分子间作用力 F 随分子间距 r 变化(F>0 斥力,F<0 引力,r₀ 处 F=0)",
    kps: ["kp-x3-04-004"],
    keywords: ["分子力", "分子间的作用力", "分子间作用力", "F-r", "F-x", "斥力", "引力"],
  },
  {
    id: "fig-epr",
    src: "q-x3-p042-02.webp",
    box: [0.37, 0.12, 0.31, 0.235],
    caption: "分子势能 Eₚ 随分子间距 r 变化(r₀ 处 Eₚ 最小,r→∞ 时 Eₚ→0)",
    kps: ["kp-x3-04-002"],
    keywords: ["分子势能", "势能", "Ep", "E_p", "Eₚ"],
  },
  {
    id: "fig-speed-dist",
    src: "q-x3-p026-01.webp",
    box: [0.40, 0.044, 0.27, 0.068],
    caption: "气体分子速率分布曲线(温度越高,曲线峰越靠右、越平)",
    kps: ["kp-x3-03-002"],
    keywords: ["速率分布", "麦克斯韦", "分子速率", "f(v)", "速率分布曲线"],
  },
  {
    // 教学页 p70:p-V 等温线族(T₁<T₂<T₃<T₄,温度越高等温线离原点越远)
    id: "fig-pv-isotherm",
    page: 70,
    box: [0.54, 0.492, 0.175, 0.094],
    caption: "一定质量气体等温变化的 p-V 图:等温线是双曲线;温度越高,等温线离原点越远(T₁<T₂<T₃<T₄)",
    kps: ["kp-x3-06-003", "kp-x3-06-001"],
    keywords: ["p-V", "pV", "等温线", "玻意耳", "等温变化"],
  },
  {
    // 教学页 p70:p-1/V 图(过原点直线,斜率=pV=C,斜率越大温度越高)
    id: "fig-pinvv",
    page: 70,
    box: [0.43, 0.83, 0.17, 0.086],
    caption: "一定质量气体等温变化的 p-1/V 图:过原点的倾斜直线,斜率 k=pV=C(斜率越大温度越高,T₂>T₁)",
    kps: ["kp-x3-06-003", "kp-x3-06-001"],
    keywords: ["p-1/V", "p-1V", "1/V", "过原点", "玻意耳", "等温线"],
  },
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const manifest = [];
  for (const f of FIGS) {
    const srcPath = srcPathOf(f);
    const buf = await readFile(srcPath);
    const meta = await sharp(buf).metadata();
    const W = meta.width, H = meta.height;
    const [l, t, w, h] = f.box;
    const left = Math.max(0, Math.round(l * W));
    const top = Math.max(0, Math.round(t * H));
    const width = Math.min(W - left, Math.round(w * W));
    const height = Math.min(H - top, Math.round(h * H));
    const outFile = `${f.id}.webp`;
    await sharp(buf)
      .extract({ left, top, width, height })
      .webp({ quality: 92 })
      .toFile(path.join(OUT_DIR, outFile));
    console.log(`裁好 ${outFile}  源${W}x${H} → ${width}x${height} @(${left},${top})`);
    manifest.push({ id: f.id, file: outFile, caption: f.caption, kps: f.kps, keywords: f.keywords });
  }
  await writeFile(path.join(OUT_DIR, "manifest.json"), JSON.stringify({ figures: manifest }, null, 2));
  console.log(`manifest.json 写好,共 ${manifest.length} 张。`);
}

main().catch((e) => { console.error(e); process.exit(1); });
