// 第五章整合:校验并写入教学卡 → 合并知识树 → 回填 68 道题的考点。幂等。
import fs from "node:fs";

const OUT = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const r = OUT.result;
const ch5 = r.chapter;
if (!ch5 || ch5.id !== "ch5") { console.error("chapter 缺失"); process.exit(1); }

// —— 1. 卡片:净化 + 校验 + 写盘 ——
const secs = ["## 定义与规律", "## 核心公式", "## 常见误区", "## 超纲边界", "## 讲法要点"];
const kpIds5 = new Set(ch5.units.flatMap((u) => u.kps.map((k) => k.id)));
const problems = [];
let sanitized = 0;
for (const c of r.cards) {
  let m = c.markdown ?? "";
  const startRe = new RegExp("(^|\\n)---\\r?\\nid:\\s*" + c.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const mt = startRe.exec(m);
  if (mt) { const idx = mt.index + (mt[1] ? mt[1].length : 0); if (idx > 0) { m = m.slice(idx); sanitized++; } }
  m = m.replace(/\n```[\s\S]*$/, "\n").replace(/\s+$/, "") + "\n";
  c.markdown = m;
  const dollars = (m.match(/(?<!\\)\$/g) || []).length;
  if (dollars % 2 !== 0) problems.push(`${c.id}: $不配对(${dollars})`);
  const miss = secs.filter((s) => !m.includes(s));
  if (miss.length) problems.push(`${c.id}: 缺节 ${miss.join(",")}`);
  if (!/^---[\s\S]*?review_status:\s*reviewed/m.test(m.trim())) problems.push(`${c.id}: frontmatter异常`);
  if (!kpIds5.has(c.id)) problems.push(`${c.id}: 不在ch5树`);
  if (m.length < 700) problems.push(`${c.id}: 过短(${m.length})`);
}
const cardIds = new Set(r.cards.map((c) => c.id));
for (const id of kpIds5) if (!cardIds.has(id)) problems.push(`缺卡: ${id}`);

// —— 2. 回填映射校验 ——
const mapByQid = new Map(r.mappings.map((m) => [m.qid, m]));
const scratchQs = JSON.parse(fs.readFileSync("C:/Users/chenz/AppData/Local/Temp/claude/C--Users-chenz-Desktop-learnapp/6c64fa0a-47b0-435a-aa18-7d3726a4a82a/scratchpad/ch5-questions.json", "utf8"));
for (const q of scratchQs) {
  const mp = mapByQid.get(q.qid);
  if (!mp) { problems.push(`回填缺: ${q.qid}`); continue; }
  if (!kpIds5.has(mp.kp_primary)) problems.push(`${q.qid}: 回填kp非法 ${mp.kp_primary}`);
}
if (problems.length) {
  console.error(`整合校验失败 ${problems.length} 条:`);
  problems.slice(0, 20).forEach((p) => console.error("  " + p));
  process.exit(1);
}

for (const c of r.cards) fs.writeFileSync(`content/cards/${c.id}.md`, c.markdown);
console.log(`卡片写入 ${r.cards.length} 张(净化 ${sanitized})`);

// —— 3. 树合并(幂等) ——
const tree = JSON.parse(fs.readFileSync("content/tree/kp-tree.json", "utf8"));
const existing = new Set();
for (const ch of tree.chapters) if (ch.id !== "ch5") for (const u of ch.units) { existing.add(u.id); for (const k of u.kps) existing.add(k.id); }
for (const u of ch5.units) {
  if (existing.has(u.id)) throw new Error(`单元id撞车 ${u.id}`);
  for (const k of u.kps) { if (existing.has(k.id)) throw new Error(`考点id撞车 ${k.id}`); k.pages = k.pages ?? ""; }
}
tree.chapters = tree.chapters.filter((c) => c.id !== "ch5");
tree.chapters.push(ch5);
tree.scope = "人教版选择性必修第三册 全册(热学·原子物理)";
fs.writeFileSync("content/tree/kp-tree.json", JSON.stringify(tree, null, 1));
const totalKp = tree.chapters.reduce((n, c) => n + c.units.reduce((m, u) => m + u.kps.length, 0), 0);
console.log(`树合并:全书 ${tree.chapters.length} 章 ${totalKp} 考点`);

// —— 4. index 回填 ——
const index = JSON.parse(fs.readFileSync("content/questions/index-x3.json", "utf8"));
let filled = 0;
for (const q of index.questions) {
  const mp = mapByQid.get(q.qid);
  if (!mp) continue;
  q.kp_primary = mp.kp_primary;
  q.kp_secondary = (mp.kp_secondary ?? []).filter((k) => kpIds5.has(k) && k !== mp.kp_primary);
  filled++;
}
fs.writeFileSync("content/questions/index-x3.json", JSON.stringify(index, null, 1));
console.log(`回填 ${filled}/68 道题的考点`);
const orphan = index.questions.filter((q) => String(q.qid).startsWith("q-wb1-") && q.kp_primary === "").length;
console.log(`剩余无考点的 wb1 题: ${orphan}(应为0)`);
if (orphan > 0) process.exit(1);
