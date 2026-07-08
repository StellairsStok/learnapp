// 总验收:wb1 录入的机器校验。全绿才算完成。
import fs from "node:fs";
import sharp from "sharp";

const index = JSON.parse(fs.readFileSync("content/questions/index-x3.json", "utf8"));
const crops = JSON.parse(fs.readFileSync("content/questions/crops.json", "utf8"));
const tree = JSON.parse(fs.readFileSync("content/tree/kp-tree.json", "utf8"));
const progress = fs.readFileSync("content/questions/progress-wb1.md", "utf8");

const kpIds = new Set();
for (const ch of tree.chapters) for (const u of ch.units) for (const k of u.kps) kpIds.add(k.id);

const QTYPES = new Set(["单选", "多选", "填空", "计算", "实验", "判断", "简答", "选择未注明"]);
const STAGES = new Set(["concept_check", "basic_practice", "standard", "advanced", "review_test"]);
const DIFFS = new Set(["D1", "D2", "D3", "D4", "D5"]);

const wb1 = index.questions.filter((q) => String(q.qid).startsWith("q-wb1-"));
const old = index.questions.filter((q) => !String(q.qid).startsWith("q-wb1-"));
const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

// 1. 数量与唯一性
check(wb1.length === 307, `wb1 题数应为 307,实为 ${wb1.length}`);
check(old.length === 362, `旧题应保持 362,实为 ${old.length}`);
check(new Set(wb1.map((q) => q.qid)).size === wb1.length, "wb1 qid 有重复");
check(wb1.every((q) => /^q-wb1-p\d{3}-\d{2}$/.test(q.qid)), "存在不合规 qid");

// 2. 字段完整性与枚举
for (const q of wb1) {
  check(QTYPES.has(q.qtype), `${q.qid} qtype 非法: ${q.qtype}`);
  check(DIFFS.has(q.difficulty), `${q.qid} difficulty 非法: ${q.difficulty}`);
  check(STAGES.has(q.stage), `${q.qid} stage 非法: ${q.stage}`);
  check(q.source === "wb1", `${q.qid} 缺 source=wb1`);
  check(q.answer_status === "pending", `${q.qid} answer_status 应为 pending`);
  check(q.kp_primary === "" ? !!q.kp_proposed : kpIds.has(q.kp_primary), `${q.qid} kp 标注非法: "${q.kp_primary}"`);
  for (const k of q.kp_secondary ?? []) check(kpIds.has(k), `${q.qid} kp_secondary 非法: ${k}`);
  check(!!q.section && !!q.label, `${q.qid} 缺 section/label`);
}

// 3. index ↔ crops ↔ 磁盘图片 三向一致
let badDim = 0;
for (const q of wb1) {
  const c = crops.qids[q.qid];
  check(!!c, `${q.qid} 缺 crops 条目`);
  if (!c) continue;
  const f = `content/questions/img/${c.file}`;
  check(fs.existsSync(f), `${q.qid} 图片缺失: ${f}`);
  if (fs.existsSync(f)) {
    const meta = await sharp(f).metadata();
    if (!(meta.width >= 900 && meta.height > 80)) { badDim++; fails.push(`${q.qid} 图片尺寸异常 ${meta.width}x${meta.height}`); }
  }
}
const orphanCrops = Object.keys(crops.qids).filter((k) => k.startsWith("q-wb1-") && !wb1.some((q) => q.qid === k));
check(orphanCrops.length === 0, `crops 有孤儿条目: ${orphanCrops.slice(0, 5).join(",")}`);
const diskImgs = fs.readdirSync("content/questions/img").filter((f) => f.startsWith("q-wb1-"));
check(diskImgs.length === 307, `磁盘 wb1 图片应 307,实为 ${diskImgs.length}`);

// 4. 覆盖:progress 覆盖 p001-p071
for (let i = 1; i <= 71; i++) check(progress.includes(`p${String(i).padStart(3, "0")}`), `progress 缺 p${String(i).padStart(3, "0")}`);

// 5. 难度直方图(这本册子有难题:D4+D5 必须 > 0)
const hist = { D1: 0, D2: 0, D3: 0, D4: 0, D5: 0 };
for (const q of wb1) hist[q.difficulty]++;
check(hist.D4 + hist.D5 > 0, "难度评级失败:D4+D5 为 0");

// 6. 第五章统计
const ch5 = wb1.filter((q) => q.kp_primary === "");
const proposed = {};
for (const q of ch5) proposed[q.kp_proposed] = (proposed[q.kp_proposed] || 0) + 1;

console.log("========== wb1 总验收 ==========");
console.log(`旧题不变: ${old.length}/362 | wb1 新增: ${wb1.length}/307 | 磁盘图片: ${diskImgs.length}`);
console.log(`难度直方图: ${JSON.stringify(hist)}`);
console.log(`按章分布: ` + JSON.stringify((() => { const b = {}; for (const q of wb1) { const ch = q.kp_primary === "" ? "ch5(待建树)" : q.kp_primary.startsWith("kp-x3-0") ? ("ch" + (Number(q.kp_primary.slice(6, 8)) <= 4 ? 1 : Number(q.kp_primary.slice(6, 8)) <= 11 ? 2 : 3)) : q.kp_primary.startsWith("exp") ? "实验" : "ch4"; b[ch] = (b[ch] || 0) + 1; } return b; })()));
console.log(`第五章(原子核)题: ${ch5.length} 道,建议聚类: ${JSON.stringify(proposed)}`);
console.log(`有配图题: ${wb1.filter((q) => q.has_figure).length}`);
if (fails.length === 0) {
  console.log("✅ 全部校验通过(ALL GREEN)");
} else {
  console.log(`❌ ${fails.length} 项未过:`);
  for (const f of fails.slice(0, 30)) console.log("  " + f);
  process.exit(1);
}
