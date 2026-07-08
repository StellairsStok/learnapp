// 合库:打标结果(tmp/wb1-tags.json)+ 裁图清单(scripts/data/wb1-crop-manifest.json)
//      + 节标题(tmp/wb1-tag-input.json)→ 追加进 index-x3.json 与 crops.json,并写 progress-wb1.md。
// 幂等:重复运行会先移除旧的 wb1 条目再追加。旧题(q-x3-)零改动。
import fs from "node:fs";

const TAGS = JSON.parse(fs.readFileSync("tmp/wb1-tags.json", "utf8"));
const MANIFEST = JSON.parse(fs.readFileSync("scripts/data/wb1-crop-manifest.json", "utf8"));
const INPUT = JSON.parse(fs.readFileSync("tmp/wb1-tag-input.json", "utf8"));
const TREE = JSON.parse(fs.readFileSync("content/tree/kp-tree.json", "utf8"));

const kpIds = new Set();
for (const ch of TREE.chapters) for (const u of ch.units) for (const k of u.kps) kpIds.add(k.id);

const tagByQid = new Map();
for (const p of TAGS.pages) for (const it of p.items) tagByQid.set(it.qid, it);
const secByPage = new Map(INPUT.pages.map((p) => [p.wbPage, p]));

// 规范化 + 校验。第五章(树未建)题目的主题会被误填进 kp_primary/kp_secondary 文字,统一收进 kp_proposed。
const looksLikeId = (s) => /^(kp-x3-|exp-x3-)/.test(String(s ?? ""));
const problems = [];
let ch5Fixed = 0;
const entries = [];
for (const m of MANIFEST.items) {
  const t = tagByQid.get(m.qid);
  if (!t) { problems.push(`${m.qid}: 缺打标结果`); continue; }
  const pageInfo = secByPage.get(m.wbPage);

  let kpPrimary = t.kp_primary ?? "";
  let kpProposed = t.kp_proposed ?? "";
  // kp_primary 不在树里:若是"像 id 但树里没有"→真错误硬拦;若是中文主题文字→第五章,转 proposed
  if (kpPrimary !== "" && !kpIds.has(kpPrimary)) {
    if (looksLikeId(kpPrimary)) { problems.push(`${m.qid}: kp_primary 是非法 id: ${kpPrimary}`); continue; }
    if (!kpProposed) kpProposed = kpPrimary; // 中文主题落入建议归属
    kpPrimary = "";
    ch5Fixed++;
  }
  // kp_secondary:只保留树里真实存在的 id,其余(含中文主题)静默丢弃
  const kpSecondary = (t.kp_secondary ?? []).filter((k) => kpIds.has(k));
  if (kpPrimary === "" && !kpProposed) problems.push(`${m.qid}: 第五章题缺 kp_proposed`);

  entries.push({
    qid: m.qid,
    page: m.wbPage,
    section: (pageInfo?.section ?? "").slice(0, 60),
    label: t.label || `T${m.n}`,
    qtype: t.qtype,
    informal: false,
    kp_primary: kpPrimary,
    kp_secondary: kpSecondary,
    ...(kpProposed ? { kp_proposed: kpProposed } : {}),
    models: t.models ?? [],
    situation: t.situation ?? "",
    difficulty: t.difficulty,
    stage: t.stage,
    has_figure: !!t.has_figure,
    figure_type: t.figure_type ?? "",
    source_note: `必刷题印刷页${m.printedPage}·题号${m.n}${m.segments > 1 ? "·跨栏拼接" : ""}`,
    answer_status: "pending",
    source: "wb1",
  });
}
console.log(`第五章主题从 kp_primary 归一到 kp_proposed: ${ch5Fixed} 题`);
if (problems.length) {
  console.error(`合库前校验失败 ${problems.length} 条:`);
  for (const p of problems.slice(0, 20)) console.error("  " + p);
  process.exit(1);
}

// —— index 合并 ——
const index = JSON.parse(fs.readFileSync("content/questions/index-x3.json", "utf8"));
const before = index.questions.length;
index.questions = index.questions.filter((q) => !String(q.qid).startsWith("q-wb1-"));
const oldUntouched = index.questions.length;
index.questions.push(...entries);
index.meta.wb1_source = {
  name: "高考必刷题·物理选择性必修第三册(主书.pdf,75页,内容页=PDF5-75,印刷页1-68)",
  ingested: "2026-07-08",
  count: entries.length,
  note: "答案册不在此PDF内,answer_status 全部 pending,待创始人提供答案册",
};
fs.writeFileSync("content/questions/index-x3.json", JSON.stringify(index, null, 1));

// —— crops 合并 ——
const crops = JSON.parse(fs.readFileSync("content/questions/crops.json", "utf8"));
for (const k of Object.keys(crops.qids)) if (k.startsWith("q-wb1-")) delete crops.qids[k];
for (const m of MANIFEST.items) {
  const t = tagByQid.get(m.qid);
  crops.qids[m.qid] = { file: `${m.qid}.webp`, pages: [m.wbPage], confidence: "high", label: t.label || `T${m.n}` };
}
fs.writeFileSync("content/questions/crops.json", JSON.stringify(crops, null, 1));

// —— progress-wb1.md ——
const lines = ["# 必刷题(wb1)逐页录入清单", "", "映射:wb1 pNNN = PDF 第 NNN+4 页;印刷页 = pNNN-3。p001-p003 为目录/导引,无题。", ""];
lines.push(`p001: 目录页,0题`, `p002: 目录页,0题`, `p003: 亮点导引,0题`);
for (const p of INPUT.pages) {
  const qs = MANIFEST.items.filter((i) => i.wbPage === p.wbPage);
  lines.push(`p${String(p.wbPage).padStart(3, "0")}(印刷${p.printedPage},${p.pageKind}): ${qs.length}题 ${qs.map((q) => q.qid.slice(-2)).join(",")} | ${p.section.slice(0, 40)}`);
}
lines.push("", `总计:${MANIFEST.items.length} 题`);
fs.writeFileSync("content/questions/progress-wb1.md", lines.join("\n"));

console.log(`合库完成:旧题 ${oldUntouched} 保持不变(合并前共${before}),新增 wb1 ${entries.length} 题;progress-wb1.md 已写。`);
