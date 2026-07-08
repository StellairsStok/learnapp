#!/usr/bin/env node
// 正式练习册切题工具(qcut)
// 用法:
//   node scripts/qcut.mjs --book wb1 --pages "tmp/wb1-pages/wb1-60-*.png" --out content/questions/img --report tmp/qcut-review

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import {
  buildEntriesFromQuestionInfo,
  pageElementRects,
  pageNameOf,
  wbPageFromImageName,
} from "./lib/qcut-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IMG_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

const sha256hex = (msg) => crypto.createHash("sha256").update(msg).digest("hex");
const hmac = (key, msg) => crypto.createHmac("sha256", key).update(msg).digest();
const pad = (n, l = 3) => String(n).padStart(l, "0");
const slash = (p) => p.replace(/\\/g, "/");

function parseArgs(argv) {
  const out = {
    book: "wb1",
    pages: "",
    out: "content/questions/img",
    report: "tmp/qcut-review",
    cache: "tmp/qcut-cache",
    manifest: "",
    rawDir: "",
    force: false,
    delayMs: 500,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") out.force = true;
    else if (a === "--book") out.book = argv[++i];
    else if (a === "--pages") out.pages = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--report") out.report = argv[++i];
    else if (a === "--cache") out.cache = argv[++i];
    else if (a === "--manifest") out.manifest = argv[++i];
    else if (a === "--raw-dir") out.rawDir = argv[++i];
    else if (a === "--delay-ms") out.delayMs = Number(argv[++i]);
    else if (a === "--help" || a === "-h") out.help = true;
    else if (!out.pages) out.pages = a;
    else throw new Error(`未知参数: ${a}`);
  }
  if (!out.manifest) out.manifest = `tmp/qcut-manifest-${out.book}.json`;
  return out;
}

function printHelp() {
  console.log(`qcut - Stellairs 练习册自动切题

必用:
  --pages <glob|dir|pdf|range>   例如 "tmp/wb1-pages/wb1-60-*.png" 或 "tmp/wb1-pages/wb1-60-08~75.png"

常用:
  --book wb1
  --out content/questions/img
  --report tmp/qcut-review
  --force              覆盖已存在同名题图
  --raw-dir tmp/qcut   优先读取 tmp/qcut/<页名>/raw.json,用于离线夹具测试
`);
}

function escapeRe(s) {
  return s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function expandRange(input) {
  const m = input.match(/^(.*?)(\d+)\s*~\s*(\d+)(\.[A-Za-z0-9]+)?$/);
  if (!m) return null;
  const [, prefix, a, b, extRaw] = m;
  const start = Number(a), end = Number(b);
  const ext = extRaw || ".png";
  const width = a.length;
  const files = [];
  const step = start <= end ? 1 : -1;
  for (let n = start; step > 0 ? n <= end : n >= end; n += step) files.push(`${prefix}${pad(n, width)}${ext}`);
  return files;
}

function expandGlob(input) {
  const abs = path.resolve(ROOT, input);
  if (!/[?*]/.test(abs)) return null;
  const dir = path.dirname(abs);
  const base = path.basename(abs);
  const re = new RegExp(`^${base.split("").map((ch) => ch === "*" ? ".*" : ch === "?" ? "." : escapeRe(ch)).join("")}$`, "i");
  return fs.readdirSync(dir)
    .filter((f) => re.test(f))
    .map((f) => path.join(dir, f))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true }));
}

function renderPdf(pdfFile, book) {
  const outDir = path.join(ROOT, "tmp", "qcut-pdf-pages", book);
  fs.mkdirSync(outDir, { recursive: true });
  const prefix = path.join(outDir, "page");
  console.log(`PDF 渲染: ${pdfFile} -> ${slash(path.relative(ROOT, outDir))}`);
  try {
    execFileSync("pdftoppm", ["-r", "300", "-png", pdfFile, prefix], { stdio: "inherit" });
  } catch (e) {
    throw new Error(
      `PDF 渲染需要 Poppler 的 pdftoppm 命令(当前不可用: ${e.code || e.message})。` +
      `请安装 Poppler,或先把 PDF 每页导出成 PNG 后用 --pages 指向图片目录。`
    );
  }
  return fs.readdirSync(outDir)
    .filter((f) => /^page-\d+\.png$/i.test(f))
    .map((f) => path.join(outDir, f))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true }));
}

function resolveInputs(spec, book) {
  if (!spec) throw new Error("缺少 --pages");
  if (spec.includes(",")) {
    return spec.split(",").flatMap((s) => resolveInputs(s.trim(), book));
  }
  const range = expandRange(spec);
  if (range) return range.map((f) => path.resolve(ROOT, f)).filter((f) => fs.existsSync(f));
  const globbed = expandGlob(spec);
  if (globbed) return globbed.filter((f) => IMG_EXT.has(path.extname(f).toLowerCase()));
  const abs = path.resolve(ROOT, spec);
  if (!fs.existsSync(abs)) throw new Error(`找不到输入: ${spec}`);
  const st = fs.statSync(abs);
  if (st.isDirectory()) {
    return fs.readdirSync(abs)
      .filter((f) => IMG_EXT.has(path.extname(f).toLowerCase()))
      .map((f) => path.join(abs, f))
      .sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true }));
  }
  if (path.extname(abs).toLowerCase() === ".pdf") return renderPdf(abs, book);
  return [abs];
}

// 会提交的数据文件优先放 scripts/data/(tmp/ 已被 gitignore,只作旧位置兼容)
function dataFile(name) {
  const tracked = path.join(ROOT, "scripts", "data", name);
  return fs.existsSync(tracked) ? tracked : path.join(ROOT, "tmp", name);
}

let _creds = null;
// 懒加载:全部命中缓存时无需 .secrets 存在,可纯离线重跑
function getCreds() {
  if (_creds) return _creds;
  const file = path.join(ROOT, ".secrets", "tencent.json");
  if (!fs.existsSync(file)) throw new Error("缺少 .secrets/tencent.json，无法调用腾讯云 OCR(缓存未命中的页需要联网识别)。");
  _creds = JSON.parse(fs.readFileSync(file, "utf8"));
  return _creds;
}

async function tcCall(action, payloadObj, creds) {
  const host = "ocr.tencentcloudapi.com";
  const service = "ocr";
  const version = "2018-11-19";
  const payload = JSON.stringify(payloadObj);
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const canonicalRequest = [
    "POST", "/", "",
    `content-type:application/json; charset=utf-8\nhost:${host}\n`,
    "content-type;host",
    sha256hex(payload),
  ].join("\n");
  const scope = `${date}/${service}/tc3_request`;
  const stringToSign = ["TC3-HMAC-SHA256", timestamp, scope, sha256hex(canonicalRequest)].join("\n");
  const kSigning = hmac(hmac(hmac(`TC3${creds.SecretKey}`, date), service), "tc3_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  const res = await fetch(`https://${host}`, {
    method: "POST",
    headers: {
      Authorization: `TC3-HMAC-SHA256 Credential=${creds.SecretId}/${scope}, SignedHeaders=content-type;host, Signature=${signature}`,
      "Content-Type": "application/json; charset=utf-8",
      "X-TC-Action": action,
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Version": version,
      "X-TC-Region": creds.Region || "ap-guangzhou",
    },
    body: payload,
  });
  return (await res.json()).Response;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadQuestionSplit(imgPath, opt) {
  const cacheDir = path.resolve(ROOT, opt.cache);
  fs.mkdirSync(cacheDir, { recursive: true });
  const original = fs.readFileSync(imgPath);
  const hash = sha256hex(original);
  const cacheFile = path.join(cacheDir, `${hash}.json`);
  const name = pageNameOf(imgPath);
  const rawFixture = opt.rawDir ? path.join(ROOT, opt.rawDir, name, "raw.json") : "";

  if (fs.existsSync(cacheFile)) {
    return { response: JSON.parse(fs.readFileSync(cacheFile, "utf8")), cache: "hit", hash };
  }
  if (rawFixture && fs.existsSync(rawFixture)) {
    const response = JSON.parse(fs.readFileSync(rawFixture, "utf8"));
    fs.writeFileSync(cacheFile, JSON.stringify(response, null, 2), "utf8");
    return { response, cache: "fixture", hash };
  }

  const jpeg = await sharp(original).jpeg({ quality: 88 }).toBuffer();
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let response;
    try {
      response = await tcCall("QuestionSplitOCR", { ImageBase64: jpeg.toString("base64") }, getCreds());
    } catch (e) {
      // 网络异常/超时同样重试(此前只重试特定错误码)
      last = { Code: "NetworkError", Message: e.message };
      if (attempt === 3) break;
      await sleep(opt.delayMs * Math.pow(2, attempt));
      continue;
    }
    if (!response.Error) {
      fs.writeFileSync(cacheFile, JSON.stringify(response, null, 2), "utf8");
      return { response, cache: "miss", hash };
    }
    last = response.Error;
    const retryable = /RequestLimitExceeded|InternalError|LimitExceeded/i.test(last.Code || "");
    if (!retryable || attempt === 3) break;
    await sleep(opt.delayMs * Math.pow(2, attempt));
  }
  throw new Error(`${name} OCR 失败: ${last?.Code || "Unknown"} ${last?.Message || ""}`);
}

function makePieceSource(pageSource, rect) {
  return { sourceId: pageSource.id, sourceImage: pageSource.imagePath, rect };
}

function derivedPieceFlags(pieces, sources) {
  const pages = new Set();
  const colsByPage = new Map();
  for (const p of pieces) {
    const source = sources[p.sourceId];
    const page = source?.wbPage ?? wbPageFromImageName(p.sourceImage);
    const mid = source?.meta?.width ? source.meta.width / 2 : 1320;
    const col = p.rect.left + p.rect.width / 2 < mid ? "L" : "R";
    pages.add(page);
    if (!colsByPage.has(page)) colsByPage.set(page, new Set());
    colsByPage.get(page).add(col);
  }
  return {
    crossPage: pages.size > 1,
    crossColumn: [...colsByPage.values()].some((cols) => cols.size > 1),
  };
}

function safeRect(r, meta) {
  // left/top 也要夹在页面内,否则坏的 override 值会让 sharp.extract 直接抛错
  const left = Math.min(Math.max(0, Math.round(r.left)), Math.max(0, meta.width - 2));
  const top = Math.min(Math.max(0, Math.round(r.top)), Math.max(0, meta.height - 2));
  const width = Math.max(1, Math.min(meta.width - left, Math.round(r.width)));
  const height = Math.max(1, Math.min(meta.height - top, Math.round(r.height)));
  return { left, top, width, height };
}

// 整页图按需读盘,不再全程常驻内存(~68页×13MB);接口返回矫正图时才驻留 buffer
const _bufferCache = new Map();
function sourceBuffer(source) {
  if (source.buffer) return source.buffer;
  if (!_bufferCache.has(source.imagePath)) {
    if (_bufferCache.size > 4) _bufferCache.delete(_bufferCache.keys().next().value);
    _bufferCache.set(source.imagePath, fs.readFileSync(source.imagePath));
  }
  return _bufferCache.get(source.imagePath);
}

// 灰黑墨迹行扫描(低饱和+低亮度):正文/线条图/照片算,彩色栏目标题/红水印/浅灰透印不算
function grayInkRows(data, info, minInk) {
  const rows = [];
  const rowMinX = [];
  const rowMaxX = [];
  for (let y = 0; y < info.height; y++) {
    let ink = 0;
    let mn = Infinity, mx = -1;
    for (let x = 0; x < info.width; x++) {
      const p = (y * info.width + x) * info.channels;
      const r0 = data[p], g0 = data[p + 1], b0 = data[p + 2];
      const luma = r0 * 0.3 + g0 * 0.6 + b0 * 0.1;
      const sat = Math.max(r0, g0, b0) - Math.min(r0, g0, b0);
      if (luma < 160 && sat < 60) {
        ink++;
        if (x < mn) mn = x;
        if (x > mx) mx = x;
      }
    }
    rows[y] = ink >= minInk;
    rowMinX[y] = mn;
    rowMaxX[y] = mx;
  }
  return { rows, rowMinX, rowMaxX };
}

// 每页自适应探测页脚线:页脚格言/页码的位置每页浮动 ±40px,固定带宽会漏/误伤。
// 扫底部条带,最后一个"矮 run"(<90px)就是页脚行,其上沿即页脚线。
async function footerTopOf(source) {
  if (source._footerTop != null) return source._footerTop;
  const meta = source.meta;
  const strip = safeRect({ left: 60, top: meta.height - 260, width: meta.width - 120, height: 252 }, meta);
  const { data, info } = await sharp(sourceBuffer(source)).extract(strip).raw().toBuffer({ resolveWithObject: true });
  const { rows } = grayInkRows(data, info, Math.max(10, Math.floor(info.width * 0.004)));
  // 页脚区可能是多行(格言 + 更低的页码角标):自底向上吸收连续矮 run(间隙<90px),
  // 吸收到的最高一行的上沿才是页脚线
  let footer = meta.height - 60; // 找不到页脚时保守兜底
  let y = rows.length - 1;
  let lastAbsorbedTop = -1;
  while (y >= 0) {
    while (y >= 0 && !rows[y]) y--;
    if (y < 0) break;
    let end = y;
    let start = y;
    while (start > 0 && rows[start - 1]) start--;
    if (end - start >= 130) break; // 高块是正文内容,停止吸收(格言+页码可连成~100px)
    if (lastAbsorbedTop >= 0 && lastAbsorbedTop - end >= 90) break; // 间隙太大,不属于页脚区
    if (strip.top + start < meta.height - 215) break; // 页脚区只在页面最底部,再高就是正文
    lastAbsorbedTop = start;
    y = start - 1;
  }
  if (lastAbsorbedTop >= 0) footer = strip.top + lastAbsorbedTop - 8;
  source._footerTop = footer;
  return footer;
}

async function tightenVertical(srcBuffer, rect, meta, footerTop = null) {
  const r = safeRect(rect, meta);
  if (r.height < 120) return { rect: r, trimmedTail: false };
  const { data, info } = await sharp(srcBuffer).extract(r).raw().toBuffer({ resolveWithObject: true });
  const rows = [];
  const minInk = Math.max(8, Math.floor(info.width * 0.004));
  for (let y = 0; y < info.height; y++) {
    let ink = 0;
    for (let x = 0; x < info.width; x++) {
      const p = (y * info.width + x) * info.channels;
      const rr = data[p], gg = data[p + 1], bb = data[p + 2];
      if (rr < 238 || gg < 238 || bb < 238) ink++;
    }
    rows[y] = ink >= minInk;
  }
  let first = rows.findIndex(Boolean);
  let last = rows.length - 1;
  while (last >= 0 && !rows[last]) last--;
  if (first < 0 || last <= first) return { rect: r, trimmedTail: false };

  const runs = [];
  let s = -1;
  for (let y = first; y <= last; y++) {
    if (rows[y]) {
      if (s < 0) s = y;
    } else if (s >= 0) {
      runs.push([s, y - 1]);
      s = -1;
    }
  }
  if (s >= 0) runs.push([s, last]);

  // 页脚短句丢弃:只对压在"本页实测页脚线"之下的孤立小 run 生效。
  // 此前用相对高度(84%)判断,会把公式/答案短行(如"1:31")当页脚误杀。
  let trimmedTail = false;
  const fTop = footerTop ?? meta.height - 170;
  if (runs.length >= 2) {
    const tail = runs[runs.length - 1];
    const prev = runs[runs.length - 2];
    const gap = tail[0] - prev[1];
    const tailAbsTop = r.top + tail[0];
    if (tailAbsTop >= fTop - 6 && tail[1] - tail[0] < 90 && gap > 24) {
      last = prev[1];
      trimmedTail = true;
    }
  }

  const top = Math.max(0, r.top + Math.max(0, first - 8));
  const bottom = Math.min(meta.height, r.top + last + 10);
  return { rect: { left: r.left, top, width: r.width, height: Math.max(1, bottom - top) }, trimmedTail };
}

async function cropPiece(source, rect, reportPartFile = "", tighten = true) {
  const buf0 = sourceBuffer(source);
  // 人工 override 的矩形是精确指定的,不做自动修剪,只做越界钳制
  const tightened = tighten
    ? await tightenVertical(buf0, rect, source.meta, await footerTopOf(source))
    : { rect: safeRect(rect, source.meta), trimmedTail: false };
  const buf = await sharp(buf0)
    .extract(safeRect(tightened.rect, source.meta))
    .resize({ width: 1200, withoutEnlargement: false })
    .webp({ quality: 90 })
    .toBuffer();
  if (reportPartFile) fs.writeFileSync(reportPartFile, buf);
  return { buffer: buf, rect: tightened.rect, trimmedTail: tightened.trimmedTail };
}

async function stitchPieces(pieceBuffers) {
  const metas = await Promise.all(pieceBuffers.map((b) => sharp(b).metadata()));
  const gap = 18;
  const width = Math.max(...metas.map((m) => m.width || 1200));
  const height = metas.reduce((s, m) => s + (m.height || 0), 0) + gap * (pieceBuffers.length - 1);
  const layers = [];
  let y = 0;
  for (const [i, b] of pieceBuffers.entries()) {
    layers.push({ input: b, left: 0, top: y });
    y += (metas[i].height || 0) + gap;
  }
  return sharp({ create: { width, height, channels: 3, background: "#ffffff" } })
    .composite(layers)
    .webp({ quality: 90 })
    .toBuffer();
}

function readOverrides() {
  const file = dataFile("qcut-overrides.json");
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function drawBoxes(source, pageEntries, pageDir) {
  const rects = [];
  for (const q of pageEntries) {
    for (const [i, p] of q.pieces.entries()) {
      if (p.sourceId !== source.id) continue;
      rects.push({ ...p.rect, label: `${q.pageSeq}${q.pieces.length > 1 ? String.fromCharCode(97 + i) : ""}` });
    }
  }
  if (!rects.length) return null;
  const svg = Buffer.from(`<svg width="${source.meta.width}" height="${source.meta.height}" xmlns="http://www.w3.org/2000/svg">${
    rects.map((r) =>
      `<rect x="${r.left}" y="${r.top}" width="${r.width}" height="${r.height}" fill="none" stroke="#ff2248" stroke-width="6"/>` +
      `<text x="${r.left + 14}" y="${r.top + 64}" font-family="Arial" font-size="60" font-weight="700" fill="#ff2248">${r.label}</text>`
    ).join("")
  }</svg>`);
  const out = path.join(pageDir, "boxes.jpg");
  await sharp(sourceBuffer(source)).composite([{ input: svg }]).jpeg({ quality: 82 }).toFile(out);
  return out;
}

function rel(from, to) {
  return slash(path.relative(from, to));
}

function confidenceOf(item, expectedByPage) {
  const notes = [];
  if (item.fallback) notes.push("expected-fallback");
  if (item.crossPage) notes.push("cross-page");
  if (item.crossColumn) notes.push("cross-column");
  if (item.pieces.length > 3) notes.push("many-blocks");
  if (!item.text) notes.push("empty-text");
  if (item.trimmedTail) notes.push("trimmed-tail");
  if (item.anomaly) notes.push(`anomaly:${item.anomaly}`);
  // anomaly(截断/重叠/编号断档/孤儿续段等)一律降级,确保审查页高亮
  const medium =
    Boolean(item.anomaly) ||
    notes.includes("expected-fallback") ||
    notes.includes("many-blocks") ||
    notes.includes("empty-text");
  return {
    level: medium ? "medium" : "high",
    notes,
    expectedPageCount: expectedByPage?.[item.wbPage] ?? null,
  };
}

function manualCounts() {
  const file = dataFile("wb1-crop-manifest.json");
  if (!fs.existsSync(file)) return {};
  const m = JSON.parse(fs.readFileSync(file, "utf8"));
  const by = {};
  for (const it of m.items || []) by[it.wbPage] = (by[it.wbPage] || 0) + 1;
  return by;
}

function loadExpectedItems() {
  const file = dataFile("wb1-crop-manifest.json");
  if (!fs.existsSync(file)) return [];
  const m = JSON.parse(fs.readFileSync(file, "utf8"));
  return (m.items || []).slice().sort((a, b) => a.wbPage - b.wbPage || (a.column === b.column ? a.y - b.y : a.column === "L" ? -1 : 1));
}

const FALLBACK_TOP = 240;
const FALLBACK_BOTTOM = 3745;
const FALLBACK_COLS = { L: { x0: 70, x1: 1345 }, R: { x0: 1305, x1: 2600 } };
const FALLBACK_PAD_ABOVE = 18;
const FALLBACK_PAD_BELOW = 18;

function fallbackRect(source, colName, y0, y1) {
  const col = FALLBACK_COLS[colName];
  if (!source || !col) return null;
  const left = Math.max(0, Math.min(source.meta.width - 1, col.x0));
  const right = Math.max(left + 1, Math.min(source.meta.width, col.x1));
  const top = Math.max(0, Math.min(source.meta.height - 1, Math.round(y0)));
  const bottom = Math.max(top + 1, Math.min(source.meta.height, Math.round(y1)));
  return { left, top, width: right - left, height: bottom - top };
}

function fallbackSegments(cur, next, sourceByWb, topHints = new Map()) {
  const segs = [];
  const curSource = sourceByWb.get(cur.wbPage);
  if (!curSource) return segs;
  const seq = Number(cur.qid?.match(/-(\d{2})$/)?.[1] || cur.n || 0);
  const hintedTop = topHints.get(`${cur.wbPage}-${seq}`);
  const startY = Number.isFinite(hintedTop) ? Math.max(cur.y, hintedTop) : cur.y;
  const topPad = Number.isFinite(hintedTop) ? 8 : FALLBACK_PAD_ABOVE;
  const y0 = Math.max(FALLBACK_TOP, startY - topPad);
  if (next && next.wbPage === cur.wbPage && next.column === cur.column) {
    const rect = fallbackRect(curSource, cur.column, y0, next.y - FALLBACK_PAD_BELOW);
    if (rect) segs.push({ source: curSource, rect });
    return segs;
  }

  const rect = fallbackRect(curSource, cur.column, y0, FALLBACK_BOTTOM);
  if (rect) segs.push({ source: curSource, rect });
  if (!next) return segs;

  if (next.wbPage === cur.wbPage && next.column !== cur.column && next.y > FALLBACK_TOP + 320) {
    const extra = fallbackRect(curSource, next.column, FALLBACK_TOP, next.y - FALLBACK_PAD_BELOW);
    if (extra) segs.push({ source: curSource, rect: extra });
  }
  if (next.wbPage === cur.wbPage + 1 && next.column === "L" && next.y > FALLBACK_TOP + 320) {
    const nextSource = sourceByWb.get(next.wbPage);
    const extra = fallbackRect(nextSource, "L", FALLBACK_TOP, next.y - FALLBACK_PAD_BELOW);
    if (extra) segs.push({ source: nextSource, rect: extra });
  }
  return segs;
}

// 为旧清单中的"单道题"构建兜底条目(题级兜底;不再整页替换)
function buildFallbackEntry(cur, next, sourceByWb, book, topHints = new Map()) {
  const segs = fallbackSegments(cur, next, sourceByWb, topHints);
  if (!segs.length) return null;
  const source = sourceByWb.get(cur.wbPage);
  const seq = Number(cur.qid?.match(/-(\d{2})$/)?.[1] || 0);
  return {
    wbPage: cur.wbPage,
    startWbPage: cur.wbPage,
    pageName: source?.pageName || `p${pad(cur.wbPage)}`,
    sourceId: source?.id,
    pageSeq: seq || undefined,
    forcedQid: cur.qid || `q-${book}-p${pad(cur.wbPage)}-${pad(seq || 1, 2)}`,
    groupType: "expected-fallback",
    mode: "expected-fallback",
    stem: "",
    text: "",
    options: [],
    preview: `expected fallback: printed p${cur.printedPage}, #${cur.n}, ${cur.column}`,
    crossColumn: segs.length > 1 && segs.some((s) => s.source.wbPage === cur.wbPage),
    crossPage: segs.some((s) => s.source.wbPage !== cur.wbPage),
    fallback: true,
    pieces: segs.map((s) => makePieceSource(s.source, s.rect)),
  };
}

const rectArea = (r) => Math.max(0, r.width) * Math.max(0, r.height);
const intersectRect = (a, b) => {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
};
const intersectArea = (a, b) => {
  const r = intersectRect(a, b);
  return r ? rectArea(r) : 0;
};
const addAnomaly = (item, tag) => {
  if (!item.anomaly) item.anomaly = tag;
  else if (!item.anomaly.includes(tag)) item.anomaly = `${item.anomaly}; ${tag}`;
};

async function grayInkStats(source, rect) {
  const r = safeRect(rect, source.meta);
  const { data, info } = await sharp(sourceBuffer(source)).extract(r).raw().toBuffer({ resolveWithObject: true });
  let pixels = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const rr = data[i], gg = data[i + 1], bb = data[i + 2];
    const luma = rr * 0.3 + gg * 0.6 + bb * 0.1;
    const sat = Math.max(rr, gg, bb) - Math.min(rr, gg, bb);
    if (luma < 180 && sat < 80) pixels++;
  }
  const area = info.width * info.height;
  return { pixels, ratio: area ? pixels / area : 0 };
}

async function findInkOverlapRepairQids(entries, sources, overrides, expectedByQid) {
  const pieces = [];
  for (const entry of entries) {
    const qid = entry.forcedQid;
    if (!qid || !expectedByQid.has(qid)) continue;
    const locked = Boolean(overrides[qid]);
    const entryPieces = locked
      ? overrides[qid].map((r) => {
          const base = entry.pieces[0];
          const sourceId = r.sourceImage
            ? sources.find((s) => slash(s.imagePath).endsWith(slash(r.sourceImage)))?.id ?? base?.sourceId
            : base?.sourceId;
          return { sourceId, rect: { left: r.left, top: r.top, width: r.width, height: r.height } };
        })
      : entry.pieces;
    for (const piece of entryPieces) {
      pieces.push({ qid, locked, piece, rect: piece.rect, sourceId: piece.sourceId });
    }
  }

  const repair = new Set();
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const a = pieces[i];
      const b = pieces[j];
      if (a.qid === b.qid || a.sourceId !== b.sourceId) continue;
      const inter = intersectRect(a.rect, b.rect);
      if (!inter) continue;
      const area = rectArea(inter);
      if (area <= 0.3 * Math.min(rectArea(a.rect), rectArea(b.rect)) || inter.height <= 60) continue;
      const source = sources[a.sourceId];
      const stats = source ? await grayInkStats(source, inter) : { pixels: Infinity, ratio: 1 };
      if (stats.ratio <= 0.03 || stats.pixels <= 1000) continue;
      if (!a.locked) repair.add(a.qid);
      if (!b.locked) repair.add(b.qid);
    }
  }
  return repair;
}

async function repairInkOverlaps(entries, sources, overrides, expectedByQid, expectedItems, sourceByWb, book, topHints, fallbackEntries, fallbackReasons) {
  const repairQids = await findInkOverlapRepairQids(entries, sources, overrides, expectedByQid);
  if (!repairQids.size) return [];
  const expIdx = new Map(expectedItems.map((it, i) => [it.qid, i]));
  const repaired = [];
  for (let i = 0; i < entries.length; i++) {
    const oldEntry = entries[i];
    const qid = oldEntry.forcedQid;
    if (!repairQids.has(qid)) continue;
    const cur = expectedByQid.get(qid);
    if (!cur) continue;
    const next = expectedItems[expIdx.get(qid) + 1] || null;
    const entry = buildFallbackEntry(cur, next, sourceByWb, book, topHints);
    if (!entry) continue;
    entry.mode = `${entry.mode}+overlap-repair`;
    entries[i] = entry;
    repaired.push(qid);
    if (!oldEntry.fallback) fallbackEntries.push(entry);
    fallbackReasons[cur.wbPage] = [fallbackReasons[cur.wbPage], `overlap-repair ${qid}`].filter(Boolean).join("; ");
  }
  return repaired;
}

// 截断自检:看一块裁剪的正下方(到页脚带为止)有没有"暗色墨迹",
// 且这墨迹既不属于其他题的块、也不是 API 报告过的元素(板块标题等)。
// 命中即疑似被裁掉的内容(丢配图/丢末行正是这样发生的,当时 API 和自检都没报)。
async function inkBelow(source, rect, allItems, selfItem, relPath) {
  const meta = source.meta;
  const footerTop = await footerTopOf(source);
  const bandTop = rect.top + rect.height + 2;
  const bandH = Math.min(220, footerTop - bandTop);
  if (bandH < 25) return false;
  const band = safeRect({ left: rect.left, top: bandTop, width: rect.width, height: bandH }, meta);
  const { data, info } = await sharp(sourceBuffer(source)).extract(band).raw().toBuffer({ resolveWithObject: true });
  const { rows, rowMinX, rowMaxX } = grayInkRows(data, info, Math.max(10, Math.floor(info.width * 0.006)));
  // 找第一个墨迹 run:必须紧邻裁剪底边(110px 内)且有实体(≥12 行)
  let runStart = -1;
  for (let y = 0; y < rows.length; y++) {
    if (rows[y]) {
      if (runStart < 0) runStart = y;
    } else if (runStart >= 0) {
      if (y - runStart >= 12) break;
      runStart = -1;
    }
  }
  if (runStart < 0 || runStart > 110) return false;
  let runEnd = runStart;
  while (runEnd < rows.length && rows[runEnd]) runEnd++;
  if (runEnd - runStart < 12) return false;
  // run 矩形收窄到墨迹的实际横向范围,否则窄标题对上整块宽的矩形永远盖不够覆盖率
  let xMin = Infinity, xMax = -1;
  for (let y = runStart; y < runEnd; y++) {
    if (!rows[y]) continue;
    if (rowMinX[y] < xMin) xMin = rowMinX[y];
    if (rowMaxX[y] > xMax) xMax = rowMaxX[y];
  }
  if (xMax < 0) return false;
  const runRect = { left: band.left + xMin, top: band.top + runStart, width: xMax - xMin + 1, height: runEnd - runStart };

  // 覆盖判定看"合计覆盖率":墨迹 run 可能同时压着栏目标题(元素)和下一题(块),
  // 单个矩形都不到 30% 但加起来已经解释了这片墨迹
  let covered = 0;
  for (const other of allItems) {
    if (other === selfItem) continue;
    for (const op of other.pieces) {
      if (slash(op.sourceImage) !== relPath) continue;
      covered += intersectArea(runRect, op.rect);
    }
  }
  for (const er of source.elementRects || []) {
    covered += intersectArea(runRect, er);
  }
  return covered < 0.45 * rectArea(runRect);
}

// 任务书F的页级自检:题号连续性 / 面积超限 / 块重叠 / 截断检测。
// 只标 anomaly 供审查页高亮,绝不自动替换。
async function selfChecks(manifestItems, sources, sourceByWb, expectedItems = []) {
  const sourceByImage = new Map();
  for (const s of sources) {
    const rel = slash(path.relative(ROOT, s.imagePath));
    if (!sourceByImage.has(rel)) sourceByImage.set(rel, s);
  }
  const expectedNoByQid = new Map(expectedItems.map((it) => [it.qid, it.n]));

  // 1) 题号连续性:同节内应递增,新节从 1 重来
  const stemNo = (t) => {
    const m = (t || "").match(/^\s*(\d{1,3})\s*[.、．·]/);
    return m ? Number(m[1]) : null;
  };
  let prevNo = null;
  let prevPage = null;
  for (const item of manifestItems) {
    // 输入页不连续时题号自然断档,重置基准避免误报
    if (prevPage != null && item.wbPage > prevPage + 1) prevNo = null;
    if (item.pieces?.some((p) => p.override)) {
      prevPage = item.wbPage;
      continue;
    }
    const n = stemNo(item.text);
    const expectedNo = expectedNoByQid.get(item.qid);
    if (n != null) {
      if (expectedNo != null && n !== expectedNo) {
        addAnomaly(item, `number-mismatch(${expectedNo}->${n})`);
      }
      prevNo = n;
    } else if (item.fallback && prevNo != null) {
      prevNo += 1; // 兜底题没有文字但占一个题号,序列不留空洞
    } else if (!item.fallback) {
      prevNo = null; // 其他无题号条目(孤儿等)状态未知,重置避免连环误报
    }
    prevPage = item.wbPage;
  }

  for (const item of manifestItems) {
    // 2) 面积超限:各块面积之和超过所在页面的 60%
    const areaBySource = new Map();
    for (const p of item.pieces) {
      const key = slash(p.sourceImage);
      areaBySource.set(key, (areaBySource.get(key) || 0) + rectArea(p.rect));
    }
    for (const [rel, area] of areaBySource) {
      const s = sourceByImage.get(rel);
      if (s && area > 0.6 * s.meta.width * s.meta.height) addAnomaly(item, "oversize");
    }
  }

  // 3) 块重叠:不同题的块在同一源页上重叠超过小块面积的 30%
  const piecesBySource = new Map();
  for (const item of manifestItems) {
    for (const p of item.pieces) {
      const key = slash(p.sourceImage);
      if (!piecesBySource.has(key)) piecesBySource.set(key, []);
      piecesBySource.get(key).push({ item, rect: p.rect, sourceImage: key });
    }
  }
  for (const list of piecesBySource.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (list[i].item === list[j].item) continue;
        const a = list[i].rect, b = list[j].rect;
        const inter = intersectArea(a, b);
        const interH = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
        const interRect = intersectRect(a, b);
        if (!interRect) continue;
        const source = sourceByImage.get(list[i].sourceImage);
        const stats = source ? await grayInkStats(source, interRect) : { pixels: Infinity, ratio: 1 };
        if (stats.ratio <= 0.03 || stats.pixels <= 1000) continue;
        // 上下相邻题因留白 padding 产生的细条重叠不算,只报实质性侵入
        if (inter > 0.3 * Math.min(rectArea(a), rectArea(b)) && interH > 60) {
          addAnomaly(list[i].item, `overlap(${list[j].item.qid})`);
          addAnomaly(list[j].item, `overlap(${list[i].item.qid})`);
        }
      }
    }
  }

  // 4) 截断检测:每题在每个源页上最靠下的块,查其下边缘
  for (const item of manifestItems) {
    if ((item.anomaly || "").includes("crop-failed")) continue;
    if (item.pieces?.some((p) => p.override)) continue;
    const bottomBySource = new Map();
    for (const p of item.pieces) {
      const key = slash(p.sourceImage);
      const cur = bottomBySource.get(key);
      if (!cur || p.rect.top + p.rect.height > cur.rect.top + cur.rect.height) bottomBySource.set(key, p);
    }
    for (const [rel, p] of bottomBySource) {
      const source = sourceByImage.get(rel);
      if (!source) continue;
      if (await inkBelow(source, p.rect, manifestItems, item, rel)) {
        addAnomaly(item, "possible-truncation");
        break;
      }
    }
  }
}

function pageReport(manifest, expectedByPage, processedPages = null) {
  const by = {};
  for (const q of manifest.items) by[q.wbPage] = (by[q.wbPage] || 0) + 1;
  const basePages = processedPages ? [...processedPages] : [...new Set([...Object.keys(by), ...Object.keys(expectedByPage)].map(Number))];
  const pages = basePages.map(Number).sort((a, b) => a - b);
  return pages.map((p) => ({
    wbPage: p,
    actual: by[p] || 0,
    expected: expectedByPage[p] ?? null,
    ok: expectedByPage[p] == null || expectedByPage[p] === (by[p] || 0),
  }));
}

function writeReview(reportDir, manifest) {
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>qcut review ${manifest.book}</title>
  <style>
    body{margin:0;font-family:system-ui,-apple-system,"Microsoft YaHei",sans-serif;background:#111827;color:#eef2ff}
    header{position:sticky;top:0;background:#0f172acc;border-bottom:1px solid #334155;padding:14px 20px;backdrop-filter:blur(12px);z-index:5}
    h1{font-size:20px;margin:0 0 6px}.sub{color:#a5b4fc;font-size:13px}
    main{padding:18px;display:grid;gap:22px}.page{border:1px solid #334155;border-radius:10px;background:#172033;padding:14px}
    .page h2{font-size:16px;margin:0 0 12px}.grid{display:grid;grid-template-columns:minmax(240px,420px) 1fr;gap:16px;align-items:start}
    .boxes{width:100%;border-radius:6px;background:#fff}.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px}
    .card{border:1px solid #334155;border-radius:8px;background:#0f172a;padding:10px}.card.problem{border-color:#f59e0b}
    .thumb{width:100%;max-height:260px;object-fit:contain;background:#fff;border-radius:4px}
    .meta{font-size:12px;color:#cbd5e1;margin:6px 0}.qid{font-weight:700;color:#93c5fd}
    textarea{width:100%;min-height:42px;background:#020617;color:#e5e7eb;border:1px solid #334155;border-radius:6px}
    button{background:#38bdf8;border:0;border-radius:7px;color:#06202d;font-weight:700;padding:8px 12px;cursor:pointer}
    label{font-size:12px;color:#e2e8f0;display:flex;gap:6px;align-items:center;margin:6px 0}
    @media(max-width:860px){.grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <header>
    <h1>qcut review: ${manifest.book}</h1>
    <div class="sub">${manifest.items.length} 题 · ${manifest.generatedAt}</div>
    <button id="export">导出问题清单</button>
  </header>
  <main>
    ${manifest.pages.map((p) => `
      <section class="page">
        <h2>p${pad(p.wbPage)} · ${p.items.length} 题 ${p.expectedCount == null ? "" : `· 对照 ${p.expectedCount}`}</h2>
        <div class="grid">
          ${p.boxes ? `<a href="${rel(reportDir, path.resolve(ROOT, p.boxes))}"><img class="boxes" src="${rel(reportDir, path.resolve(ROOT, p.boxes))}"></a>` : "<div></div>"}
          <div class="cards">
            ${p.items.map((q) => `
              <article class="card ${q.confidence.level !== "high" ? "problem" : ""}" data-qid="${q.qid}">
                <a href="${rel(reportDir, path.resolve(ROOT, q.file))}"><img class="thumb" src="${rel(reportDir, path.resolve(ROOT, q.file))}"></a>
                <div class="meta"><span class="qid">${q.qid}</span> · ${q.groupType || "?"} · ${q.pieces.length}块 · ${q.confidence.level}</div>
                ${q.anomaly ? `<div class="meta" style="color:#f59e0b">⚠ ${q.anomaly.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]))}</div>` : ""}
                <div class="meta">${(q.text || q.preview || "").slice(0, 90).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]))}</div>
                <label><input type="checkbox" class="bad"> 有问题</label>
                <textarea placeholder="备注"></textarea>
              </article>
            `).join("")}
          </div>
        </div>
      </section>
    `).join("")}
  </main>
  <script>
    document.querySelector('#export').onclick = () => {
      const problems = [...document.querySelectorAll('.card')].filter(c => c.querySelector('.bad').checked || c.querySelector('textarea').value.trim()).map(c => ({
        qid: c.dataset.qid,
        bad: c.querySelector('.bad').checked,
        note: c.querySelector('textarea').value.trim()
      }));
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), problems }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'qcut-problems-${manifest.book}.json';
      a.click();
    };
  </script>
</body>
</html>`;
  fs.writeFileSync(path.join(reportDir, "index.html"), html, "utf8");
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  if (opt.help) return printHelp();

  const inputs = resolveInputs(opt.pages, opt.book);
  if (!inputs.length) throw new Error("没有找到可处理的图片页。");
  const outDir = path.resolve(ROOT, opt.out);
  const reportDir = path.resolve(ROOT, opt.report);
  const manifestFile = path.resolve(ROOT, opt.manifest);
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(reportDir, { recursive: true });

  const expectedByPage = manualCounts();
  const overrides = readOverrides();
  const sources = [];
  const pending = [];
  let previous = null;
  const errors = [];

  console.log(`qcut: ${inputs.length} 页, book=${opt.book}, out=${slash(path.relative(ROOT, outDir))}`);
  for (const [idx, imgPath] of inputs.entries()) {
    const name = pageNameOf(imgPath);
    const wbPage = wbPageFromImageName(imgPath, idx);
    const pageDir = path.join(reportDir, name);
    fs.mkdirSync(pageDir, { recursive: true });
    try {
      const { response, cache } = await loadQuestionSplit(imgPath, opt);
      fs.writeFileSync(path.join(pageDir, "raw.json"), JSON.stringify(response, null, 2), "utf8");
      if (response.Error) throw new Error(`${response.Error.Code} ${response.Error.Message || ""}`);
      const qInfos = response.QuestionInfo || [];
      let pageEntries = [];
      for (const [pi, qPage] of qInfos.entries()) {
        // 只有接口返回矫正图时才驻留 buffer,否则按需从磁盘读(见 sourceBuffer)
        const corrected = qPage.ImageBase64 ? Buffer.from(qPage.ImageBase64, "base64") : null;
        const meta = corrected ? await sharp(corrected).metadata() : await sharp(imgPath).metadata();
        const source = {
          id: sources.length, imagePath: imgPath, buffer: corrected, meta, wbPage, pageName: name,
          // 整页原子元素框,供截断自检区分"已知内容"与"API 没看见的墨迹"
          elementRects: pageElementRects(qPage, meta),
        };
        sources.push(source);
        const entries = buildEntriesFromQuestionInfo(qPage, meta).map((e) => ({
          ...e,
          wbPage,
          startWbPage: wbPage,
          pageName: name,
          sourceId: source.id,
          pieces: e.pieces.map((r) => makePieceSource(source, r)),
          sourcePart: pi + 1,
        }));
        pageEntries.push(...entries);
      }

      // 续段归并:contPrev 不一定只在第一条(一次响应可含多个 QuestionInfo 块)。
      // 跨页合并必须校验页相邻,否则前页失败/输入不连续时会并进错误的页。
      const kept = [];
      for (const entry of pageEntries) {
        if (entry.contPrev) {
          const crossPage = kept.length === 0;
          const target = crossPage ? previous : kept[kept.length - 1];
          let mergeOk = Boolean(target);
          if (mergeOk && crossPage) {
            mergeOk = target.wbPage === wbPage - 1;
            if (mergeOk) {
              // 真正延续到本页的题,必然切到上一页版心底部;
              // 不到底说明"上一题"另有其人(比如恰好是被 OCR 漏掉、要走兜底的那道)
              const maxBottom = Math.max(...target.pieces.map((p) => p.rect.top + p.rect.height));
              const srcMeta = sources[target.pieces[target.pieces.length - 1]?.sourceId]?.meta;
              if (srcMeta && maxBottom < srcMeta.height - 450) mergeOk = false;
            }
          }
          if (mergeOk) {
            target.pieces.push(...entry.pieces);
            target.text = [target.text, entry.text].filter(Boolean).join("\n");
            target.options.push(...entry.options);
            if (crossPage) {
              target.crossPage = true;
              target.mode += "+cross-page";
            }
            continue;
          }
          entry.anomaly = "contPrev-orphan";
        }
        kept.push(entry);
      }
      pageEntries = kept;
      pending.push(...pageEntries);
      if (pageEntries.length) previous = pageEntries[pageEntries.length - 1];
      console.log(`  ${name}: ${pageEntries.length}题 (${cache})`);
      if (idx < inputs.length - 1 && cache === "miss") await sleep(opt.delayMs);
    } catch (e) {
      errors.push({ pageName: name, wbPage, message: e.message });
      console.error(`  ${name}: 失败 ${e.message}`);
    }
  }

  const processedPages = new Set(sources.map((s) => s.wbPage));
  const detectedByPage = {};
  for (const entry of pending) detectedByPage[entry.startWbPage] = (detectedByPage[entry.startWbPage] || 0) + 1;

  const sourceByWb = new Map();
  for (const source of sources) {
    if (!sourceByWb.has(source.wbPage)) sourceByWb.set(source.wbPage, source);
  }

  // ---- 题级兜底:逐题对齐旧手工清单,只兜底缺失/碎块的题,检出正确的题一律保留 ----
  const expectedItems = loadExpectedItems();
  const expectedByQid = new Map(expectedItems.map((it) => [it.qid, it]));
  const expIdx = new Map(expectedItems.map((it, i) => [it, i]));
  const expByPage = new Map();
  for (const it of expectedItems) {
    if (!expByPage.has(it.wbPage)) expByPage.set(it.wbPage, []);
    expByPage.get(it.wbPage).push(it);
  }
  const nextOf = (it) => expectedItems[expIdx.get(it) + 1] || null;

  const fallbackReasons = {};
  const droppedDetected = [];
  const fallbackEntries = [];
  const outputEntries = [];
  const topHints = new Map();

  for (const page of [...processedPages].sort((a, b) => a - b)) {
    const det = pending.filter((e) => e.startWbPage === page);
    const exp = expByPage.get(page) || [];
    if (!exp.length) {
      outputEntries.push(...det);
      continue;
    }

    const source = sourceByWb.get(page);
    const mid = source ? Math.round(source.meta.width / 2) : 1320;
    const detInfo = det.map((e) => {
      const first = e.pieces[0]?.rect || { left: 0, top: 0, width: 0, height: 0 };
      const totalHeight = e.pieces.reduce((s2, p) => s2 + (p.rect?.height || 0), 0);
      return {
        e,
        column: first.left + first.width / 2 < mid ? "L" : "R",
        y: first.top,
        tiny: totalHeight > 0 && totalHeight < 120,
        matched: false,
      };
    });

    // 把检出的题对到旧清单上。旧清单里 loose-ocr 条目的 y 不可靠,
    // 所以栏内数量吻合时按顺序一一配对(顺序永远可靠),数量不符才退回 y 就近匹配。
    const missing = [];
    const pairUp = (cur, hit) => {
      hit.matched = true;
      if (hit.tiny) {
        // 检出了但只是碎块:丢弃碎块,用它的位置提示兜底起点
        droppedDetected.push({ page, qid: cur.qid, reason: "tiny-fragment" });
        const seq = Number(cur.qid?.match(/-(\d{2})$/)?.[1] || 0);
        topHints.set(`${page}-${seq}`, hit.y + 26);
        missing.push(cur);
      } else {
        hit.e.forcedQid = cur.qid; // 有旧清单对照的页,qid 全部按旧清单对齐
        outputEntries.push(hit.e);
      }
    };
    const byCol = { L: { exp: [], det: [] }, R: { exp: [], det: [] } };
    for (const cur of exp) (byCol[cur.column] || byCol.L).exp.push(cur);
    for (const d of detInfo) byCol[d.column].det.push(d);
    for (const col of ["L", "R"]) {
      const expCol = byCol[col].exp.slice().sort((a, b) => a.y - b.y);
      const detCol = byCol[col].det.slice().sort((a, b) => a.y - b.y);
      if (expCol.length === detCol.length) {
        for (let i = 0; i < expCol.length; i++) pairUp(expCol[i], detCol[i]);
      } else {
        for (const cur of expCol) {
          const cands = detCol
            .filter((d) => !d.matched && Math.abs(d.y - cur.y) < 420)
            .sort((a, b) => Math.abs(a.y - cur.y) - Math.abs(b.y - cur.y));
          const hit = cands.find((d) => !d.tiny) ?? cands[0];
          if (hit) pairUp(cur, hit);
          else missing.push(cur);
        }
      }
    }
    for (const d of detInfo.filter((x) => !x.matched)) {
      if (d.e.anomaly) outputEntries.push(d.e); // 孤儿续段等带异常标记的仍保留供人工确认
      else droppedDetected.push({ page, reason: `unmatched-extra (${d.column} y${d.y})` });
    }
    if (missing.length) {
      fallbackReasons[page] = `missing ${missing.map((m) => m.qid).join(",")} (detected ${det.length}/${exp.length})`;
      for (const cur of missing) {
        const entry = buildFallbackEntry(cur, nextOf(cur), sourceByWb, opt.book, topHints);
        if (entry) {
          fallbackEntries.push(entry);
          outputEntries.push(entry);
        }
      }
    }
  }

  // 页内按旧清单序号排回阅读顺序(无对照页保持检出顺序,sort 是稳定的)
  const forcedSeq = (e) => Number(e.forcedQid?.match(/-(\d{2})$/)?.[1] ?? 999);
  outputEntries.sort((a, b) => a.startWbPage - b.startWbPage || forcedSeq(a) - forcedSeq(b));

  const overlapRepaired = await repairInkOverlaps(
    outputEntries,
    sources,
    overrides,
    expectedByQid,
    expectedItems,
    sourceByWb,
    opt.book,
    topHints,
    fallbackEntries,
    fallbackReasons
  );
  if (overlapRepaired.length) {
    console.log(`  重叠返修: ${overlapRepaired.length} 题 ${overlapRepaired.join(",")}`);
  }

  const fallbackPages = Object.keys(fallbackReasons).map(Number).sort((a, b) => a - b);
  if (fallbackEntries.length) {
    console.log(`  题级兜底: ${fallbackEntries.length} 题(涉及 ${fallbackPages.length} 页); 丢弃碎块/多余检出 ${droppedDetected.length} 个`);
  }

  const seqByPage = {};
  const manifestItems = [];
  for (const entry of outputEntries) {
    let pageSeq;
    let qid;
    if (entry.forcedQid) {
      const forcedSeq = Number(entry.forcedQid.match(/-(\d{2})$/)?.[1] || entry.pageSeq || 0);
      pageSeq = forcedSeq || (seqByPage[entry.startWbPage] || 0) + 1;
      seqByPage[entry.startWbPage] = Math.max(seqByPage[entry.startWbPage] || 0, pageSeq);
      qid = entry.forcedQid;
    } else {
      pageSeq = (seqByPage[entry.startWbPage] = (seqByPage[entry.startWbPage] || 0) + 1);
      qid = `q-${opt.book}-p${pad(entry.startWbPage)}-${pad(pageSeq, 2)}`;
    }
    const outFile = path.join(outDir, `${qid}.webp`);
    const pageDir = path.join(reportDir, entry.pageName);
    entry.pageSeq = pageSeq;

    if (overrides[qid]) {
      const base = entry.pieces[0];
      entry.pieces = overrides[qid].map((r) => ({
        sourceId: r.sourceImage
          ? sources.find((s) => slash(s.imagePath).endsWith(slash(r.sourceImage)))?.id ?? base.sourceId
          : base.sourceId,
        sourceImage: r.sourceImage || base.sourceImage,
        rect: { left: r.left, top: r.top, width: r.width, height: r.height },
        override: true,
      }));
      entry.mode += "+override";
      entry.hasOverride = true;
      if (entry.anomaly === "contPrev-orphan") entry.anomaly = "";
    }

    const reportParts = [];
    // override 的题无条件重裁,否则"对坏图加 override 重跑"毫无效果
    if (!fs.existsSync(outFile) || opt.force || entry.hasOverride) {
      try {
        const pieceBuffers = [];
        for (const [i, p] of entry.pieces.entries()) {
          const source = sources[p.sourceId];
          if (!source) throw new Error(`piece 缺少源页(sourceId=${p.sourceId})`);
          const partFile = entry.pieces.length > 1 ? path.join(pageDir, `${qid}-${String.fromCharCode(97 + i)}.webp`) : "";
          const cropped = await cropPiece(source, p.rect, partFile, !p.override);
          p.rect = cropped.rect;
          if (cropped.trimmedTail) entry.trimmedTail = true;
          pieceBuffers.push(cropped.buffer);
          if (partFile) reportParts.push(path.relative(ROOT, partFile));
        }
        const final = pieceBuffers.length === 1 ? pieceBuffers[0] : await stitchPieces(pieceBuffers);
        fs.writeFileSync(outFile, final);
      } catch (e) {
        // 单题裁剪失败不中断整轮,记异常供审查页高亮
        entry.anomaly = [entry.anomaly, `crop-failed: ${e.message}`].filter(Boolean).join("; ");
        console.error(`  ${qid} 裁剪失败: ${e.message}`);
      }
    }

    const derivedFlags = derivedPieceFlags(entry.pieces, sources);

    manifestItems.push({
      qid,
      file: path.relative(ROOT, outFile),
      wbPage: entry.startWbPage,
      sourcePages: [...new Set(entry.pieces.map((p) => wbPageFromImageName(p.sourceImage)))],
      sourceImages: [...new Set(entry.pieces.map((p) => path.relative(ROOT, p.sourceImage)))],
      pageSeq,
      groupType: entry.groupType,
      mode: entry.mode,
      pieces: entry.pieces.map((p) => ({ sourceImage: path.relative(ROOT, p.sourceImage), rect: p.rect, override: Boolean(p.override) })),
      partFiles: reportParts,
      crossColumn: Boolean(entry.crossColumn || derivedFlags.crossColumn),
      crossPage: Boolean(entry.crossPage || derivedFlags.crossPage),
      text: entry.text,
      options: entry.options,
      preview: entry.preview,
      fallback: Boolean(entry.fallback),
      trimmedTail: Boolean(entry.trimmedTail),
      anomaly: entry.anomaly || "",
      confidence: null,
    });
  }

  await selfChecks(manifestItems, sources, sourceByWb, expectedItems);

  for (const item of manifestItems) item.confidence = confidenceOf(item, expectedByPage);

  const itemsByPage = new Map();
  for (const item of manifestItems) {
    if (!itemsByPage.has(item.wbPage)) itemsByPage.set(item.wbPage, []);
    itemsByPage.get(item.wbPage).push(item);
  }
  const boxesByPage = new Map();
  for (const source of sources) {
    const entries = outputEntries.filter((e) => e.pieces.some((p) => p.sourceId === source.id));
    if (!entries.length) continue;
    const pageDir = path.join(reportDir, source.pageName);
    const boxes = await drawBoxes(source, entries, pageDir);
    if (boxes) boxesByPage.set(source.wbPage, path.relative(ROOT, boxes));
  }

  const pages = [...itemsByPage.entries()].sort(([a], [b]) => a - b).map(([wbPage, items]) => ({
    wbPage,
    expectedCount: expectedByPage[wbPage] ?? null,
    boxes: boxesByPage.get(wbPage) || "",
    items,
  }));
  const pageChecks = pageReport({ items: manifestItems }, expectedByPage, processedPages);
  const same = pageChecks.filter((p) => p.expected != null && p.ok).length;
  const totalCompared = pageChecks.filter((p) => p.expected != null).length;
  const finalConsistency = totalCompared ? same / totalCompared : null;

  // OCR 真实一致率(兜底前的检出 vs 旧清单)与最终产出一致率分开报告,
  // 后者含兜底,天然偏高,不能单独作为质量指标
  const ocrPageChecks = [...processedPages].sort((a, b) => a - b).map((p) => ({
    wbPage: p,
    detected: detectedByPage[p] || 0,
    expected: expectedByPage[p] ?? null,
    ok: expectedByPage[p] == null || expectedByPage[p] === (detectedByPage[p] || 0),
  }));
  const ocrSame = ocrPageChecks.filter((p) => p.expected != null && p.ok).length;
  const ocrCompared = ocrPageChecks.filter((p) => p.expected != null).length;
  const ocrConsistency = ocrCompared ? ocrSame / ocrCompared : null;

  const anomalies = manifestItems.filter((i) => i.anomaly);

  const manifest = {
    generatedAt: new Date().toISOString(),
    book: opt.book,
    command: `node scripts/qcut.mjs ${process.argv.slice(2).join(" ")}`,
    count: manifestItems.length,
    outputDir: path.relative(ROOT, outDir),
    reportDir: path.relative(ROOT, reportDir),
    ocrPageConsistency: ocrConsistency,
    finalPageConsistency: finalConsistency,
    detectedCount: pending.length,
    keptDetectedCount: outputEntries.filter((e) => !e.fallback).length,
    droppedDetected,
    fallbackPages,
    fallbackReasons,
    fallbackCount: fallbackEntries.length,
    anomalyCount: anomalies.length,
    ocrPageChecks,
    pageChecks,
    errors,
    items: manifestItems,
    pages,
  };

  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), "utf8");
  writeReview(reportDir, manifest);

  // --force 重切后清理孤儿旧图。只清"本次处理过的页"的文件,单页重跑不会误删全书
  if (opt.force) {
    const valid = new Set(manifestItems.map((i) => path.basename(i.file)));
    for (const f of fs.readdirSync(outDir)) {
      const m = f.match(new RegExp(`^q-${escapeRe(opt.book)}-p(\\d{3})-\\d{2}\\.webp$`));
      if (m && processedPages.has(Number(m[1])) && !valid.has(f)) {
        fs.unlinkSync(path.join(outDir, f));
        console.log(`  清理孤儿图: ${f}`);
      }
    }
  }

  console.log(`完成: ${manifest.count}题 (自动 ${manifest.keptDetectedCount} + 兜底 ${manifest.fallbackCount})`);
  if (ocrConsistency != null) console.log(`OCR 真实一致率: ${(ocrConsistency * 100).toFixed(1)}% (${ocrSame}/${ocrCompared})`);
  if (finalConsistency != null) console.log(`最终产出一致率: ${(finalConsistency * 100).toFixed(1)}% (${same}/${totalCompared})`);
  if (anomalies.length) {
    console.log(`异常标记 ${anomalies.length} 题(审查页已高亮): ${anomalies.slice(0, 8).map((i) => `${i.qid}[${i.anomaly}]`).join(", ")}${anomalies.length > 8 ? " …" : ""}`);
  }
  if (errors.length) console.log(`失败页: ${errors.length} 页,详见 manifest.errors`);
  console.log(`manifest: ${slash(path.relative(ROOT, manifestFile))}`);
  console.log(`review:   ${slash(path.relative(ROOT, path.join(reportDir, "index.html")))}`);
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
