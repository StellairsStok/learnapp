import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const PAGE_DIR = path.join(ROOT, "tmp", "wb1-pages");
const OUT = path.join(ROOT, "tmp", "wb1-detect.json");

const PDF_OFFSET = 4; // wb1 p001 == PDF page 5
const FIRST_WB = 1;
const LAST_WB = 71;

function pageFile(wbPage) {
  const pdfPage = wbPage + PDF_OFFSET;
  return path.join(PAGE_DIR, `wb1-60-${String(pdfPage).padStart(2, "0")}.png`);
}

function isDark(r, g, b) {
  return r < 92 && g < 92 && b < 92;
}

function isGreen(r, g, b) {
  return g > 105 && g > r * 1.35 && g > b * 1.15;
}

function rowRuns(scores, threshold, minGap = 9) {
  const runs = [];
  let start = -1;
  for (let y = 0; y < scores.length; y++) {
    if (scores[y] >= threshold) {
      if (start < 0) start = y;
    } else if (start >= 0) {
      if (y - start >= 5) runs.push([start, y - 1]);
      start = -1;
    }
  }
  if (start >= 0 && scores.length - start >= 5) runs.push([start, scores.length - 1]);
  const merged = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && r[0] - last[1] <= minGap) last[1] = r[1];
    else merged.push(r);
  }
  return merged;
}

function componentRuns(mask, w, h, x0, x1, y0, y1) {
  const seen = new Uint8Array(w * h);
  const comps = [];
  const qx = [];
  const qy = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * w + x;
      if (!mask[i] || seen[i]) continue;
      let head = 0;
      qx.length = 0;
      qy.length = 0;
      qx.push(x);
      qy.push(y);
      seen[i] = 1;
      let minX = x, maxX = x, minY = y, maxY = y, count = 0;
      while (head < qx.length) {
        const cx = qx[head];
        const cy = qy[head++];
        count++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < x0 || nx >= x1 || ny < y0 || ny >= y1) continue;
            const ni = ny * w + nx;
            if (mask[ni] && !seen[ni]) {
              seen[ni] = 1;
              qx.push(nx);
              qy.push(ny);
            }
          }
        }
      }
      comps.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, count });
    }
  }
  return comps;
}

function closeMask(mask, w, h, radius = 2) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          out[yy * w + xx] = 1;
        }
      }
    }
  }
  return out;
}

async function detectPage(wbPage) {
  const file = pageFile(wbPage);
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels } = info;
  const dark = new Uint8Array(w * h);
  const green = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * channels;
      const r = data[p], g = data[p + 1], b = data[p + 2];
      if (isDark(r, g, b)) dark[y * w + x] = 1;
      if (isGreen(r, g, b)) green[y * w + x] = 1;
    }
  }

  const leftBand = [Math.round(w * 0.040), Math.round(w * 0.090)];
  const rightBand = [Math.round(w * 0.470), Math.round(w * 0.535)];
  const contentTop = Math.round(h * 0.075);
  const contentBottom = Math.round(h * 0.955);
  const thick = dark;
  const starts = [];

  for (const [column, band] of [["L", leftBand], ["R", rightBand]]) {
    const comps = componentRuns(thick, w, h, band[0], band[1], contentTop, contentBottom)
      .filter((c) => c.h >= 24 && c.h <= 72 && c.w >= 8 && c.w <= 76 && c.count >= 90)
      .sort((a, b) => a.y - b.y);
    for (const c of comps) {
      if (starts.some((s) => s.column === column && Math.abs(s.y - c.y) < 42)) continue;
      starts.push({ column, x: c.x, y: c.y, h: c.h, w: c.w, score: c.count });
    }
  }

  const greenRows = new Array(h).fill(0);
  for (let y = contentTop; y < contentBottom; y++) {
    let n = 0;
    for (let x = Math.round(w * 0.05); x < Math.round(w * 0.95); x++) n += green[y * w + x];
    greenRows[y] = n;
  }
  const headings = rowRuns(greenRows, Math.max(18, w * 0.008), 6)
    .map(([a, b]) => ({ y: a, h: b - a + 1 }))
    .filter((r) => r.h >= 8 && r.h <= 70);

  return { wbPage, pdfPage: wbPage + PDF_OFFSET, file, width: w, height: h, starts, headings };
}

async function main() {
  const pages = [];
  for (let p = FIRST_WB; p <= LAST_WB; p++) {
    pages.push(await detectPage(p));
    console.log(`p${String(p).padStart(3, "0")} starts=${pages.at(-1).starts.length} headings=${pages.at(-1).headings.length}`);
  }
  fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), pages }, null, 2), "utf8");
  console.log(`wrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
