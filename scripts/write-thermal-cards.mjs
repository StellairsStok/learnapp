import fs from "node:fs";

const out = JSON.parse(fs.readFileSync("C:/Users/chenz/AppData/Local/Temp/claude/C--Users-chenz-Desktop-learnapp/6c64fa0a-47b0-435a-aa18-7d3726a4a82a/tasks/wgmphyse5.output", "utf8"));
const cards = out.result.cards;
const tree = JSON.parse(fs.readFileSync("content/tree/kp-tree.json", "utf8"));
const treeIds = new Set();
for (const ch of tree.chapters) for (const u of ch.units) for (const k of u.kps) treeIds.add(k.id);

console.log("终审卡片:", cards.length, "| 新建:", out.result.authored, "| 补深:", out.result.deepened);

// 净化:剥掉个别终审员混入的说明/代码围栏,只保留 从真正的 frontmatter 到卡片正文末
let sanitized = 0;
for (const c of cards) {
  let m = c.markdown;
  // 找到真正的 frontmatter 起点:--- 换行紧跟 id: <该卡id>
  const startRe = new RegExp("(^|\\n)---\\r?\\nid:\\s*" + c.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const mt = startRe.exec(m);
  if (mt) {
    const startIdx = mt.index + (mt[1] ? mt[1].length : 0);
    if (startIdx > 0) { m = m.slice(startIdx); sanitized++; }
  }
  // 去掉尾部残留的代码围栏与"终版/审查"类说明块(卡片正常以 讲法要点 段结束,不含 ``` )
  m = m.replace(/\n```[\s\S]*$/, "\n").replace(/\s+$/, "") + "\n";
  c.markdown = m;
}
if (sanitized) console.log("净化(剥离终审说明前缀):", sanitized, "张");

const secs = ["## 定义与规律", "## 核心公式", "## 物理直觉", "## 最小例子", "## 常见误区", "## 超纲边界", "## 前置知识", "## 关联题型", "## 讲法要点"];
const problems = [];
for (const c of cards) {
  const m = c.markdown || "";
  const dollars = (m.match(/(?<!\\)\$/g) || []).length;
  const missSec = secs.filter((s) => !m.includes(s));
  const fm = /^---[\s\S]*?id:\s*(\S+)[\s\S]*?review_status:\s*reviewed[\s\S]*?---/m.exec(m.trim());
  if (dollars % 2 !== 0) problems.push(`${c.id}: $ 不配对(${dollars})`);
  if (missSec.length) problems.push(`${c.id}: 缺节 ${missSec.join(",")}`);
  if (!fm) problems.push(`${c.id}: frontmatter/review_status 异常`);
  if (!treeIds.has(c.id)) problems.push(`${c.id}: 不在知识树`);
  if (m.length < 800) problems.push(`${c.id}: 过短(${m.length})`);
}
// id 齐全性:41个考点是否都有卡返回
const ids = new Set(cards.map((c) => c.id));
const ch13 = [];
for (const ch of tree.chapters) if (["ch1", "ch2", "ch3"].includes(ch.id)) for (const u of ch.units) for (const k of u.kps) ch13.push(k.id);
const missing = ch13.filter((id) => !ids.has(id));
if (missing.length) problems.push("缺卡: " + missing.join(","));

console.log("硬校验问题:", problems.length);
problems.forEach((p) => console.log("  ⚠", p));

if (problems.length === 0) {
  for (const c of cards) fs.writeFileSync("content/cards/" + c.id + ".md", c.markdown);
  console.log(`\n✅ 已写入 ${cards.length} 张热学卡(1-3章全部考点)`);
  const fixed = cards.filter((c) => c.verdict === "fixed").length;
  console.log(`终审修订: ${fixed} 张 fixed / ${cards.length - fixed} 张 ok`);
  const total = fs.readdirSync("content/cards").filter((f) => f.endsWith(".md")).length;
  console.log(`现有卡片总数: ${total}(应=55:1-3章41 + 第四章14)`);
} else {
  console.log("有硬问题,未写盘");
  process.exit(1);
}
