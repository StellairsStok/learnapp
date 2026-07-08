// 打印 QuestionSplitOCR 返回的层级结构,便于核对坐标归属
import fs from 'node:fs'
import path from 'node:path'

const file = process.argv[2] || 'tmp/qcut/wb1-60-15/raw.json'
const resp = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'))

const quads = (c) => (Array.isArray(c) ? c : c ? [c] : [])
const rectStr = (c) =>
  quads(c)
    .map((q) => {
      const pts = [q.LeftTop, q.RightTop, q.LeftBottom, q.RightBottom].filter(Boolean)
      const xs = pts.map((p) => p.X), ys = pts.map((p) => p.Y)
      return `x${Math.min(...xs)}-${Math.max(...xs)} y${Math.min(...ys)}-${Math.max(...ys)}`
    })
    .join(' + ')

function walk(item, depth, tag) {
  const pad = '  '.repeat(depth)
  const text = (item.Text || '').replace(/\s+/g, '').slice(0, 24)
  console.log(`${pad}${tag} [${rectStr(item.Coord) || '无框'}] ${item.GroupType || ''} ${text}`)
  for (const key of ['Question', 'Option', 'Figure', 'Table', 'Answer', 'Parse']) {
    for (const [i, e] of (item[key] || []).entries()) {
      const etext = (e.Text || '').replace(/\s+/g, '').slice(0, 24)
      console.log(`${pad}  ·${key}[${i}] [${rectStr(e.Coord) || '无框'}] ${etext}`)
      for (const [j, sub] of (e.ResultList || []).entries()) walk(sub, depth + 2, `${key}[${i}].RL[${j}]`)
    }
  }
}

for (const [pi, page] of (resp.QuestionInfo || []).entries()) {
  console.log(`=== 页 ${pi} (${page.OrgWidth}x${page.OrgHeight}) ===`)
  for (const [i, item] of (page.ResultList || []).entries()) walk(item, 0, `块${i}`)
}
