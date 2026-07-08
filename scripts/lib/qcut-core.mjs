// qcut 核心:解析腾讯云 QuestionSplitOCR 返回,重建"一道题"的裁剪块。
// 这份代码从 scripts/qcut-test.mjs 中抽出并扩展;不要在这里放密钥或网络调用。

export const coordQuads = (coord) => (Array.isArray(coord) ? coord : coord ? [coord] : []);

export function quadToRect(quad, maxW, maxH) {
  const pts = [quad.LeftTop, quad.RightTop, quad.LeftBottom, quad.RightBottom].filter(Boolean);
  const xs = pts.map((p) => p.X);
  const ys = pts.map((p) => p.Y);
  const left = Math.max(0, Math.floor(Math.min(...xs)));
  const top = Math.max(0, Math.floor(Math.min(...ys)));
  const right = Math.min(maxW, Math.ceil(Math.max(...xs)));
  const bottom = Math.min(maxH, Math.ceil(Math.max(...ys)));
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export const isSubQ = (item) =>
  /^\s*(?:[（(]\s*\d{1,2}\s*[)）]|[①②③④⑤⑥⑦⑧⑨⑩])/.test(item.Question?.[0]?.Text || item.Text || "");

export function collectQuestions(containers) {
  const out = [];
  for (const c of containers || []) {
    const kids = (c.Question || []).flatMap((q) => q.ResultList || []);
    if (kids.length && !kids.some(isSubQ)) out.push(...collectQuestions(kids));
    else {
      if (kids.length) c.__kids = kids;
      out.push(c);
    }
  }
  return out;
}

export function textPreview(item) {
  const pick = (arr) => (Array.isArray(arr) ? arr.map((e) => e?.Text || "").join(" ") : "");
  const s = `${item.Text || ""}${pick(item.Question)} | ${pick(item.Option)}`;
  return s.replace(/\s+/g, " ").slice(0, 120);
}

export function deepTexts(item, key, out = []) {
  for (const e of item[key] || []) {
    if (e?.Text) out.push(e.Text);
    for (const sub of e.ResultList || []) deepTexts(sub, key, out);
  }
  for (const sub of item.__kids || []) deepTexts(sub, key, out);
  return out;
}

export function questionText(item) {
  const texts = [];
  if (item.Text) texts.push(item.Text);
  deepTexts(item, "Question", texts);
  return texts.join("\n").replace(/\s+\n/g, "\n").trim();
}

export function optionTexts(item) {
  return deepTexts(item, "Option").map((s) => s.trim()).filter(Boolean);
}

export const unionRect = (a, b) => {
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  return {
    left,
    top,
    width: Math.max(a.left + a.width, b.left + b.width) - left,
    height: Math.max(a.top + a.height, b.top + b.height) - top,
  };
};

export function elementRects(item, maxW, maxH, out = []) {
  for (const key of ["Question", "Option", "Figure", "Table", "Answer", "Parse"]) {
    for (const e of item[key] || []) {
      for (const q of coordQuads(e.Coord)) out.push(quadToRect(q, maxW, maxH));
      for (const sub of e.ResultList || []) elementRects(sub, maxW, maxH, out);
    }
  }
  for (const sub of item.__kids || []) elementRects(sub, maxW, maxH, out);
  return out.filter((r) => r.width > 3 && r.height > 3);
}

export const spansMid = (r, mid) => r.left < mid - 20 && r.left + r.width > mid + 20;

export function padRect(r, p, maxW, maxH) {
  const left = Math.max(0, r.left - p);
  const top = Math.max(0, r.top - p);
  return {
    left,
    top,
    width: Math.min(maxW, r.left + r.width + p) - left,
    height: Math.min(maxH, r.top + r.height + p) - top,
  };
}

export const isNewQuestion = (s) =>
  /^\s*(?:\d{1,3}\s*[.、．·]|[一二三四五六七八九十]+\s*[、.．]|【?例\s*\d*】?)/.test(s || "");

function safeUnion(rects) {
  return rects.length ? rects.reduce(unionRect) : null;
}

function columnBounds(qData, mid, maxW) {
  const solids = qData.flatMap((d) => [...d.rectsAll, ...d.elems].filter((r) => !spansMid(r, mid)));
  const leftSolids = solids.filter((r) => r.left + r.width / 2 < mid);
  const rightSolids = solids.filter((r) => r.left + r.width / 2 >= mid);
  const leftRight = leftSolids.length
    ? Math.min(mid - 8, Math.max(...leftSolids.map((r) => r.left + r.width)))
    : mid - 8;
  const rightLeft = rightSolids.length
    ? Math.max(mid + 8, Math.min(...rightSolids.map((r) => r.left)))
    : mid + 8;
  return { leftRight: Math.max(1, leftRight), rightLeft: Math.min(maxW - 1, rightLeft) };
}

export function buildEntriesFromQuestionInfo(page, meta) {
  const questions = collectQuestions(page.ResultList);
  const mid = Math.round(meta.width / 2);
  const gap = 12;
  const qData = [];

  for (const item of questions) {
    const allQuads = [...coordQuads(item.Coord), ...(item.__kids || []).flatMap((k) => coordQuads(k.Coord))];
    const rectsAll = allQuads
      .map((q) => quadToRect(q, meta.width, meta.height))
      .filter((r) => r.width > 5 && r.height > 5);
    if (!rectsAll.length) continue;
    qData.push({ item, rectsAll, elems: elementRects(item, meta.width, meta.height) });
  }

  const solidsOf = (d) => [...d.rectsAll, ...d.elems].filter((r) => !spansMid(r, mid));
  const bounds = columnBounds(qData, mid, meta.width);
  const entries = [];

  for (const d of qData) {
    const qUnion = safeUnion(d.rectsAll);
    if (!qUnion) continue;
    let pieces = [qUnion];
    let mode = "api";
    let crossColumn = false;

    if (spansMid(qUnion, mid)) {
      crossColumn = true;
      const cols = [[], []];
      for (const r of d.elems.filter((r) => !spansMid(r, mid))) {
        cols[r.left + r.width / 2 < mid ? 0 : 1].push(r);
      }

      const othersSolids = qData.filter((o) => o !== d).flatMap(solidsOf);
      for (const s of d.elems.filter((r) => spansMid(r, mid))) {
        const sBottom = s.top + s.height;
        const leftBounds = [...cols[0], ...othersSolids.filter((r) => r.left + r.width / 2 < mid)]
          .map((r) => r.top + r.height)
          .filter((b) => b < sBottom - 5);
        const lTop = leftBounds.length ? Math.max(...leftBounds) + gap : s.top;
        const lWidth = Math.max(10, Math.min(bounds.leftRight, mid - 8) - s.left);
        if (sBottom - lTop > 10 && lWidth > 10) cols[0].push({ left: s.left, top: lTop, width: lWidth, height: sBottom - lTop });

        const rightTops = othersSolids
          .filter((r) => r.left + r.width / 2 >= mid)
          .map((r) => r.top)
          .filter((t) => t > s.top + 5);
        const rBottom = rightTops.length ? Math.min(...rightTops) - gap : sBottom;
        const rLeft = Math.max(bounds.rightLeft, mid + 8);
        const rWidth = Math.max(10, s.left + s.width - rLeft);
        if (rBottom - s.top > 10 && rWidth > 10) cols[1].push({ left: rLeft, top: s.top, width: rWidth, height: rBottom - s.top });
      }

      const built = cols
        .filter((c) => c.length)
        .map((c) => safeUnion(c))
        .filter(Boolean)
        .map((c) => padRect(c, 14, meta.width, meta.height));
      if (built.length) {
        pieces = built;
        mode = `cross-column:${built.length}`;
      } else {
        mode = "api-wide";
      }
    }

    const stem = (d.item.Question?.[0]?.Text || d.item.Text || "").trim();
    const groupType = d.item.GroupType || d.item.Question?.[0]?.GroupType || "";
    entries.push({
      pieces,
      mode,
      crossColumn,
      stem,
      groupType,
      text: questionText(d.item),
      options: optionTexts(d.item),
      preview: textPreview(d.item),
    });
  }

  // "题型N/刷基础/刷素养"这类栏目标题有时被 API 当成独立条目返回。
  // 它不是题目内容:留着会被粘进上一题(垃圾)或在页首变成孤儿续段,直接过滤。
  const isSectionHeader = (e) => {
    if (e.options.length) return false;
    const h = e.pieces.reduce((s, r) => s + r.height, 0);
    if (h > 200) return false;
    return /^(题型\s*\d|刷\s*(基础|提升|素养)|微?专题|第\s*[一二三四五六七八九十\d]+\s*[章节])/.test((e.stem || "").trim());
  };
  const filtered = entries.filter((e) => !isSectionHeader(e));

  const merged = [];
  for (const e of filtered) {
    if (merged.length && !isNewQuestion(e.stem)) {
      const prev = merged[merged.length - 1];
      prev.pieces.push(...e.pieces);
      prev.mode += "+continued";
      prev.text = [prev.text, e.text].filter(Boolean).join("\n");
      prev.options.push(...e.options);
      prev.crossColumn ||= e.crossColumn;
    } else {
      merged.push(e);
    }
  }
  if (merged.length && !isNewQuestion(merged[0].stem)) merged[0].contPrev = true;
  // 续段归并后按"块的实际落栏"补判 crossColumn(api模式的续段合并此前会漏标)
  for (const e of merged) {
    if (!e.crossColumn && e.pieces.length > 1) {
      const sides = new Set(e.pieces.map((p) => (p.left + p.width / 2 < mid ? "L" : "R")));
      if (sides.size > 1) e.crossColumn = true;
    }
  }
  return merged;
}

// 整页所有"原子元素"框(题干行/选项/配图/表格,含板块标题行),用于截断自检:
// 裁剪框下方若出现"不属于任何元素、也不被任何题覆盖"的墨迹,即疑似被裁掉的内容。
// 过滤掉跨栏并集框和超高框(几何不可信)。
export function pageElementRects(page, meta) {
  const mid = Math.round(meta.width / 2);
  const out = [];
  for (const block of page.ResultList || []) {
    elementRects(block, meta.width, meta.height, out);
  }
  return out.filter((r) => r.width > 3 && r.height > 3 && r.height <= 600 && !spansMid(r, mid));
}

export function pageNameOf(file) {
  return file.replace(/\\/g, "/").split("/").pop().replace(/\.[^.]+$/, "");
}

export function wbPageFromImageName(file, fallbackIndex = 0) {
  const name = pageNameOf(file);
  const wb60 = name.match(/wb1-60-(\d{2,3})$/i);
  if (wb60) return Number(wb60[1]) - 4;
  const p = name.match(/p(\d{1,3})/i);
  if (p) return Number(p[1]);
  return fallbackIndex + 1;
}
