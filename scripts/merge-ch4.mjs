// 把第四章(原子结构和波粒二象性)合并进 kp-tree.json,并更新 scope。
// 用法:node scripts/merge-ch4.mjs <ch4-chapter.json>
// 幂等:已存在 ch4 时先替换再写回。
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const chapterFile = process.argv[2];
if (!chapterFile) { console.error("用法:node scripts/merge-ch4.mjs <ch4-chapter.json>"); process.exit(1); }

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const TREE = path.join(ROOT, "content", "tree", "kp-tree.json");

const tree = JSON.parse(await readFile(TREE, "utf8"));
const ch4 = JSON.parse(await readFile(chapterFile, "utf8"));

// 基本校验:结构 + id 规范 + 无 id 撞车
if (!ch4.id || !ch4.name || !Array.isArray(ch4.units)) throw new Error("ch4 JSON 结构不对");
const existingIds = new Set();
for (const ch of tree.chapters) for (const u of ch.units) { existingIds.add(u.id); for (const k of u.kps) existingIds.add(k.id); }
let kpCount = 0;
for (const u of ch4.units) {
  if (!/^u\d{2}$/.test(u.id)) throw new Error(`单元 id 不规范: ${u.id}`);
  if (existingIds.has(u.id)) throw new Error(`单元 id 撞车: ${u.id}`);
  for (const k of u.kps) {
    if (!/^kp-x3-\d{2}-\d{3}$/.test(k.id)) throw new Error(`考点 id 不规范: ${k.id}`);
    if (existingIds.has(k.id)) throw new Error(`考点 id 撞车: ${k.id}`);
    if (!k.name || !k.type || !Array.isArray(k.formulas) || !Array.isArray(k.pitfalls)) throw new Error(`考点字段缺失: ${k.id}`);
    k.pages = k.pages ?? "";
    kpCount++;
  }
}

tree.chapters = tree.chapters.filter((c) => c.id !== "ch4");
tree.chapters.push(ch4);
tree.scope = "人教版选择性必修第三册 第1-4章(热学·原子结构)";

await writeFile(TREE, JSON.stringify(tree, null, 1));
const total = tree.chapters.reduce((n, c) => n + c.units.reduce((m, u) => m + u.kps.length, 0), 0);
console.log(`已合并 ch4:${ch4.units.length} 个单元、${kpCount} 个考点;全书现共 ${tree.chapters.length} 章、${total} 个考点。`);
