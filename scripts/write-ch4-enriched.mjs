import fs from "node:fs";

const out = JSON.parse(fs.readFileSync("C:/Users/chenz/AppData/Local/Temp/claude/C--Users-chenz-Desktop-learnapp/6c64fa0a-47b0-435a-aa18-7d3726a4a82a/tasks/wzleu72s1.output", "utf8"));
const cards = out.result.cards;
console.log("终审返回卡片:", cards.length, "| 补充数:", out.result.enrichedCount);

const secs = ["## 定义与规律", "## 核心公式", "## 常见误区", "## 超纲边界", "## 讲法要点"];
const problems = [];
const shrunk = [];
for (const c of cards) {
  const m = c.markdown || "";
  // 统计未转义的 $(排除 \$)
  const dollars = (m.match(/(?<!\\)\$/g) || []).length;
  const missSec = secs.filter((s) => !m.includes(s));
  const fm = /^---[\s\S]*?id:\s*\S+[\s\S]*?review_status:\s*reviewed[\s\S]*?---/.test(m.trim());
  const path = "content/cards/" + c.id + ".md";
  const before = fs.existsSync(path) ? fs.readFileSync(path, "utf8").length : 0;
  if (dollars % 2 !== 0) problems.push(`${c.id}: $ 不配对(${dollars})`);
  if (missSec.length) problems.push(`${c.id}: 缺节 ${missSec.join(",")}`);
  if (!fm) problems.push(`${c.id}: frontmatter/review_status 异常`);
  if (m.length < before * 0.95) shrunk.push(`${c.id}: ${before}→${m.length}`);
}
console.log("硬校验问题:", problems.length);
problems.forEach((p) => console.log("  ⚠", p));
if (shrunk.length) { console.log("变短的卡(需人工确认没删内容):"); shrunk.forEach((s) => console.log("  ?", s)); }

if (problems.length === 0) {
  for (const c of cards) fs.writeFileSync("content/cards/" + c.id + ".md", c.markdown);
  console.log("\n✅ 已写入 14 张补充卡");
  const rows = cards.map((c) => `  ${c.id}: ${c.markdown.length} 字符 (${c.verdict})`);
  console.log("篇幅:\n" + rows.join("\n"));
} else {
  console.log("有硬问题,未写盘");
  process.exit(1);
}
