// 准备热学(1-3章)补卡:①按讲切片学案 ②导出 41 考点清单(带 name/formulas/pitfalls + 是否已有卡 + 学案切片映射)
import fs from "node:fs";
import path from "node:path";

const SCRATCH = "C:/Users/chenz/AppData/Local/Temp/claude/C--Users-chenz-Desktop-learnapp/6c64fa0a-47b0-435a-aa18-7d3726a4a82a/scratchpad";
const thermal = fs.readFileSync(path.join(SCRATCH, "hengzhong-thermal.txt"), "utf8").split("\n");
const OUTDIR = path.join(SCRATCH, "thermal-slices");
fs.mkdirSync(OUTDIR, { recursive: true });

// 讲切片(行号相对 hengzhong-thermal.txt,1-based)
const SLICES = {
  molecular: [1, 409],   // 第77讲 分子动理论
  states: [410, 1091],   // 第78讲 固体液体气体
  varmass: [1092, 1479], // 第79讲 变质量专题
  thermo: [1480, 1913],  // 第80讲 热力学定律
  expOil: [1914, 2119],  // 第81讲 油膜法
  expBoyle: [2120, thermal.length], // 第82讲 玻意耳实验
};
for (const [k, [a, b]] of Object.entries(SLICES)) {
  fs.writeFileSync(path.join(OUTDIR, k + ".txt"), thermal.slice(a - 1, b).join("\n"));
}
console.log("学案切片:", Object.keys(SLICES).map((k) => k + "(" + (SLICES[k][1] - SLICES[k][0]) + "行)").join(" "));

// 每个 unit → 学案切片键
const UNIT_SLICE = {
  u01: ["molecular"], u02: ["expOil"], u03: ["molecular", "states"], u04: ["molecular"],
  u05: ["states"], u06: ["states", "expBoyle"], u07: ["states"], u08: ["states"],
  u09: ["states", "varmass"], u10: ["states"], u11: ["states"],
  u12: ["thermo"], u13: ["thermo"], u14: ["thermo"],
};

const tree = JSON.parse(fs.readFileSync("content/tree/kp-tree.json", "utf8"));
const cardDir = "content/cards";
const existing = new Set(fs.readdirSync(cardDir).filter((f) => f.endsWith(".md")).map((f) => f.replace(".md", "")));

const kps = [];
for (const ch of tree.chapters) {
  if (!["ch1", "ch2", "ch3"].includes(ch.id)) continue;
  for (const u of ch.units) {
    for (const k of u.kps) {
      kps.push({
        id: k.id, name: k.name, type: k.type,
        unit: u.id, unitName: u.name, chapter: ch.name,
        formulas: k.formulas, pitfalls: k.pitfalls, pages: k.pages,
        hasCard: existing.has(k.id),
        slices: UNIT_SLICE[u.id] || ["molecular"],
      });
    }
  }
}
fs.writeFileSync(path.join(SCRATCH, "thermal-kps.json"), JSON.stringify(kps, null, 1));
console.log("1-3章考点:", kps.length, "| 已有卡:", kps.filter((k) => k.hasCard).map((k) => k.id).join(",") || "无", "| 需新建:", kps.filter((k) => !k.hasCard).length);
// 每片覆盖的考点数
const bySlice = {};
for (const k of kps) for (const s of k.slices) bySlice[s] = (bySlice[s] || 0) + 1;
console.log("切片覆盖考点数:", JSON.stringify(bySlice));
