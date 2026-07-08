// 腾讯云"试卷切题"(QuestionSplitOCR) 实测脚本
// 用法: node scripts/qcut-test.mjs [整页图片路径...]
// 输出: tmp/qcut/<图片名>/ 下 —— raw.json(原始返回)、boxes.jpg(画框总览)、qNN.png(每题裁剪图)
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const ROOT = path.resolve(import.meta.dirname, '..')
const creds = JSON.parse(fs.readFileSync(path.join(ROOT, '.secrets/tencent.json'), 'utf8'))

const sha256hex = (msg) => crypto.createHash('sha256').update(msg).digest('hex')
const hmac = (key, msg) => crypto.createHmac('sha256', key).update(msg).digest()

async function tcCall(action, payloadObj) {
  const host = 'ocr.tencentcloudapi.com'
  const service = 'ocr'
  const version = '2018-11-19'
  const payload = JSON.stringify(payloadObj)
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)

  const canonicalRequest = [
    'POST', '/', '',
    `content-type:application/json; charset=utf-8\nhost:${host}\n`,
    'content-type;host',
    sha256hex(payload),
  ].join('\n')
  const scope = `${date}/${service}/tc3_request`
  const stringToSign = ['TC3-HMAC-SHA256', timestamp, scope, sha256hex(canonicalRequest)].join('\n')
  const kSigning = hmac(hmac(hmac('TC3' + creds.SecretKey, date), service), 'tc3_request')
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex')

  const res = await fetch(`https://${host}`, {
    method: 'POST',
    headers: {
      Authorization: `TC3-HMAC-SHA256 Credential=${creds.SecretId}/${scope}, SignedHeaders=content-type;host, Signature=${signature}`,
      'Content-Type': 'application/json; charset=utf-8',
      'X-TC-Action': action,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Version': version,
      'X-TC-Region': creds.Region || 'ap-guangzhou',
    },
    body: payload,
  })
  return (await res.json()).Response
}

// 四点坐标 -> 外接矩形,并裁掉越界部分
function quadToRect(quad, maxW, maxH) {
  const pts = [quad.LeftTop, quad.RightTop, quad.LeftBottom, quad.RightBottom].filter(Boolean)
  const xs = pts.map((p) => p.X)
  const ys = pts.map((p) => p.Y)
  const left = Math.max(0, Math.floor(Math.min(...xs)))
  const top = Math.max(0, Math.floor(Math.min(...ys)))
  const right = Math.min(maxW, Math.ceil(Math.max(...xs)))
  const bottom = Math.min(maxH, Math.ceil(Math.max(...ys)))
  return { left, top, width: right - left, height: bottom - top }
}

// Coord 实际返回可能是"四点对象"或"四点对象的数组"(跨栏/跨块的题有多个框)
const coordQuads = (coord) => (Array.isArray(coord) ? coord : coord ? [coord] : [])

// 小问编号: (1) （1） ①… —— 见到这种编号说明再往下就是大题内部了
const isSubQ = (item) =>
  /^\s*(?:[（(]\s*\d{1,2}\s*[)）]|[①②③④⑤⑥⑦⑧⑨⑩])/.test(item.Question?.[0]?.Text || item.Text || '')

// 实际结构是嵌套的:外层 ResultList 是"题型板块",板块的 Question[].ResultList 里是每道题,
// 大题的下一层还有小问。往下钻,但遇到"孩子是小问"就停 —— 大题整体算一道题。
function collectQuestions(containers) {
  const out = []
  for (const c of containers || []) {
    const kids = (c.Question || []).flatMap((q) => q.ResultList || [])
    if (kids.length && !kids.some(isSubQ)) out.push(...collectQuestions(kids))
    else {
      if (kids.length) c.__kids = kids // 小问坐标也要算进大题的范围
      out.push(c)
    }
  }
  return out
}

function textPreview(item) {
  const pick = (arr) => (Array.isArray(arr) ? arr.map((e) => e?.Text || '').join(' ') : '')
  const s = (item.Text || '') + pick(item.Question) + ' | ' + pick(item.Option)
  return s.replace(/\s+/g, ' ').slice(0, 60)
}

const unionRect = (a, b) => {
  const left = Math.min(a.left, b.left)
  const top = Math.min(a.top, b.top)
  return {
    left, top,
    width: Math.max(a.left + a.width, b.left + b.width) - left,
    height: Math.max(a.top + a.height, b.top + b.height) - top,
  }
}

// 题目内部所有元素(题干行/选项/配图/表格,含小问里的)各自的小坐标
function elementRects(item, maxW, maxH, out = []) {
  for (const key of ['Question', 'Option', 'Figure', 'Table', 'Answer', 'Parse']) {
    for (const e of item[key] || []) {
      for (const q of coordQuads(e.Coord)) out.push(quadToRect(q, maxW, maxH))
      for (const sub of e.ResultList || []) elementRects(sub, maxW, maxH, out)
    }
  }
  return out.filter((r) => r.width > 3 && r.height > 3)
}

// 判断一个矩形是否横跨双栏中线(=跨栏并集框,真实分栏几何已丢失)
const spansMid = (r, mid) => r.left < mid - 20 && r.left + r.width > mid + 20

const pad = (r, p, maxW, maxH) => {
  const left = Math.max(0, r.left - p)
  const top = Math.max(0, r.top - p)
  return {
    left, top,
    width: Math.min(maxW, r.left + r.width + p) - left,
    height: Math.min(maxH, r.top + r.height + p) - top,
  }
}

// 多块裁剪图上下拼接成一张完整题图
async function stitch(pieces, outFile) {
  const bufs = await Promise.all(pieces.map((p) => p.buffer))
  const metas = await Promise.all(bufs.map((b) => sharp(b).metadata()))
  const GAP = 24
  const width = Math.max(...metas.map((m) => m.width))
  const height = metas.reduce((s, m) => s + m.height, 0) + GAP * (metas.length - 1)
  let y = 0
  const layers = []
  for (const [i, b] of bufs.entries()) {
    layers.push({ input: b, left: 0, top: y })
    y += metas[i].height + GAP
  }
  await sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
    .composite(layers).png().toFile(outFile)
}

async function processPage(imgPath) {
  const name = path.basename(imgPath).replace(/\.[^.]+$/, '')
  const outDir = path.join(ROOT, 'tmp/qcut', name)
  fs.mkdirSync(outDir, { recursive: true })

  // 统一转成 JPEG 控制体积(base64 后须 <10MB)
  const jpeg = await sharp(imgPath).jpeg({ quality: 88 }).toBuffer()
  console.log(`[${name}] 发送 ${(jpeg.length / 1024 / 1024).toFixed(2)}MB JPEG → QuestionSplitOCR ...`)

  const resp = await tcCall('QuestionSplitOCR', { ImageBase64: jpeg.toString('base64') })
  fs.writeFileSync(path.join(outDir, 'raw.json'), JSON.stringify(resp, null, 2))

  if (resp.Error) {
    console.error(`[${name}] 接口报错: ${resp.Error.Code} — ${resp.Error.Message}`)
    if (resp.Error.Code === 'FailedOperation.UnOpenError') {
      console.error('  → 需要先开通服务: https://console.cloud.tencent.com/ocr/overview 点「立即开通」')
    }
    return { name, error: resp.Error.Code }
  }

  const pages = resp.QuestionInfo || []
  let total = 0
  for (const [pi, page] of pages.entries()) {
    // 接口会返回矫正后的整页图,坐标基于这张图;没有就用原图
    const baseImg = page.ImageBase64 ? Buffer.from(page.ImageBase64, 'base64') : fs.readFileSync(imgPath)
    const meta = await sharp(baseImg).metadata()
    const questions = collectQuestions(page.ResultList)
    const rects = []

    // 第一遍:收集每道题的框(自身+小问)和内部元素框
    const mid = Math.round(meta.width / 2)
    const GAPB = 12
    const qData = []
    for (const item of questions) {
      const allQuads = [...coordQuads(item.Coord), ...(item.__kids || []).flatMap((k) => coordQuads(k.Coord))]
      const rectsAll = allQuads
        .map((q) => quadToRect(q, meta.width, meta.height))
        .filter((r) => r.width > 5 && r.height > 5)
      if (!rectsAll.length) continue
      qData.push({ item, rectsAll, elems: elementRects(item, meta.width, meta.height) })
    }
    // 每道题"可信的"矩形 = 不跨中线的框(跨中线的并集框几何不可信)
    const solidsOf = (d) => [...d.rectsAll, ...d.elems].filter((r) => !spansMid(r, mid))

    // 第二遍:确定每道题的裁剪块
    const entries = []
    for (const d of qData) {
      const qUnion = d.rectsAll.reduce(unionRect)
      let pieces = [qUnion]
      let mode = 'api框'

      if (spansMid(qUnion, mid)) {
        // 跨栏题:先按中线把本题的可信元素分左右两簇
        const cols = [[], []]
        for (const r of d.elems.filter((r) => !spansMid(r, mid)))
          cols[r.left + r.width / 2 < mid ? 0 : 1].push(r)

        // 跨中线的元素框(接口给的并集,分栏信息已丢)用页面上下文重建:
        // 左半段从"左栏中最近的上一块内容"底部开始,到并集框底为止;
        // 右半段从并集框顶开始,到"右栏中下一道题"顶部为止。
        const othersSolids = qData.filter((o) => o !== d).flatMap(solidsOf)
        for (const s of d.elems.filter((r) => spansMid(r, mid))) {
          const sBottom = s.top + s.height
          const leftBounds = [...cols[0], ...othersSolids.filter((r) => r.left + r.width / 2 < mid)]
            .map((r) => r.top + r.height)
            .filter((b) => b < sBottom - 5)
          const lTop = leftBounds.length ? Math.max(...leftBounds) + GAPB : s.top
          if (sBottom - lTop > 10)
            cols[0].push({ left: s.left, top: lTop, width: Math.max(10, mid - s.left), height: sBottom - lTop })

          const rightTops = othersSolids
            .filter((r) => r.left + r.width / 2 >= mid)
            .map((r) => r.top)
            .filter((t) => t > s.top + 5)
          const rBottom = rightTops.length ? Math.min(...rightTops) - GAPB : sBottom
          if (rBottom - s.top > 10)
            cols[1].push({ left: mid, top: s.top, width: s.left + s.width - mid, height: rBottom - s.top })
        }

        const built = cols
          .filter((c) => c.length)
          .map((c) => c.reduce(unionRect))
          .map((c) => pad(c, 14, meta.width, meta.height))
        if (built.length) {
          pieces = built
          mode = `跨栏重建${built.length}块`
        } else mode = 'api框(宽,未能重建)'
      }

      const stem = (d.item.Question?.[0]?.Text || d.item.Text || '').trim()
      const gt = d.item.GroupType || d.item.Question?.[0]?.GroupType || '?'
      entries.push({ pieces, mode, stem, gt, preview: textPreview(d.item) })
    }

    // 第二遍:开头不是题号的条目(如延续到下一栏的 B/C/D 选项)归并给上一题
    const isNewQuestion = (s) =>
      /^\s*(?:\d{1,3}\s*[.、．]|[一二三四五六七八九十]+\s*[、.．]|【?例\s*\d*】?)/.test(s)
    const merged = []
    for (const e of entries) {
      if (merged.length && !isNewQuestion(e.stem)) {
        const prev = merged[merged.length - 1]
        prev.pieces.push(...e.pieces)
        prev.mode += '+续段归并'
      } else merged.push(e)
    }
    if (merged.length && !isNewQuestion(merged[0].stem)) merged[0].contPrev = true

    // 第三遍:落盘 + 画框
    for (const e of merged) {
      total++
      const id = `q${String(total).padStart(2, '0')}`
      const cropped = e.pieces.map((rect) => ({ rect, buffer: sharp(baseImg).extract(rect).png().toBuffer() }))
      if (cropped.length === 1) {
        fs.writeFileSync(path.join(outDir, `${id}.png`), await cropped[0].buffer)
      } else {
        for (const [i, c] of cropped.entries())
          fs.writeFileSync(path.join(outDir, `${id}-${'abcdef'[i]}.png`), await c.buffer)
        await stitch(cropped, path.join(outDir, `${id}.png`))
      }
      e.pieces.forEach((r, i) => rects.push({ ...r, label: `${total}${e.pieces.length > 1 ? 'abcdef'[i] : ''}` }))
      const flag = e.contPrev ? ' ⚠上页题目的延续,需跨页合并' : ''
      console.log(`  ${id} (${e.mode}) [${e.gt}]${flag} ${e.preview}`)
    }

    // 画框总览图
    if (rects.length) {
      const svgRects = rects
        .map(
          (r) =>
            `<rect x="${r.left}" y="${r.top}" width="${r.width}" height="${r.height}" fill="none" stroke="red" stroke-width="6"/>` +
            `<text x="${r.left + 10}" y="${r.top + 60}" font-size="60" font-weight="bold" fill="red">${r.label}</text>`
        )
        .join('')
      const overlay = Buffer.from(`<svg width="${meta.width}" height="${meta.height}">${svgRects}</svg>`)
      await sharp(baseImg).composite([{ input: overlay }]).jpeg({ quality: 80 })
        .toFile(path.join(outDir, pages.length > 1 ? `boxes-p${pi + 1}.jpg` : 'boxes.jpg'))
    }
  }
  console.log(`[${name}] 共切出 ${total} 道题 → ${path.relative(ROOT, outDir)}`)
  return { name, total }
}

const inputs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [path.join(ROOT, 'tmp/wb1-pages/wb1-60-10.png')]

for (const p of inputs) {
  try {
    await processPage(p)
  } catch (e) {
    console.error(`[${path.basename(p)}] 失败:`, e.message, e.cause ? `(${e.cause.code || ''} ${e.cause.message || ''})` : '')
  }
}
