// 把微知识点清单写入 content/beats/{kpId}.json,写前做完整性校验
import fs from "node:fs";

const out = JSON.parse(fs.readFileSync("C:/Users/chenz/AppData/Local/Temp/claude/C--Users-chenz-Desktop-learnapp/6c64fa0a-47b0-435a-aa18-7d3726a4a82a/tasks/wv6p51nax.output", "utf8"));
const items = out.result.beats;
const tree = JSON.parse(fs.readFileSync("content/tree/kp-tree.json", "utf8"));
const allIds = [];
for (const ch of tree.chapters) for (const u of ch.units) for (const k of u.kps) allIds.push(k.id);

console.log("返回清单:", items.length, "| 树考点:", allIds.length);
const problems = [];
const byId = new Map(items.map((b) => [b.kpId, b]));
for (const id of allIds) {
  const b = byId.get(id);
  if (!b) { problems.push(`${id}: 缺清单`); continue; }
  if (!Array.isArray(b.beats) || b.beats.length < 4) { problems.push(`${id}: 条目过少(${b.beats?.length})`); continue; }
  for (const [i, bt] of b.beats.entries()) {
    if (!bt.point || !bt.check) problems.push(`${id}#${i + 1}: 缺 point/check`);
    if (bt.n !== i + 1) problems.push(`${id}#${i + 1}: 序号不连续(n=${bt.n})`);
    const dollars = ((bt.point + (bt.check || "") + (bt.trap || "")).match(/(?<!\\)\$/g) || []).length;
    if (dollars % 2 !== 0) problems.push(`${id}#${bt.n}: $ 不配对`);
  }
}
console.log("校验问题:", problems.length);
problems.slice(0, 20).forEach((p) => console.log("  ⚠", p));

if (problems.length === 0) {
  fs.mkdirSync("content/beats", { recursive: true });
  for (const b of items) {
    fs.writeFileSync(`content/beats/${b.kpId}.json`, JSON.stringify({ kpId: b.kpId, beats: b.beats }, null, 1));
  }
  const total = items.reduce((s, b) => s + b.beats.length, 0);
  const fixed = items.filter((b) => b.verdict === "fixed").length;
  console.log(`\n✅ 写入 ${items.length} 份清单,共 ${total} 条微知识点(平均 ${(total / items.length).toFixed(1)} 条/考点;二审修订 ${fixed} 份)`);
} else {
  console.log("有问题,未写盘"); process.exit(1);
}
