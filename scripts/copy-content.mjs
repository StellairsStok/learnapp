// 把 content/ 复制进 public/content/,让 Vite 作为静态资源打进 dist(静态站运行时 fetch)。
// 幂等:题图已全部就位则跳过图片复制(避免每次 dev 重复拷 24MB)。
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve("content");
const DST = path.resolve("public", "content");

function copyDir(src, dst, { skipIfSameCount = false } = {}) {
  fs.mkdirSync(dst, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  if (skipIfSameCount && fs.existsSync(dst)) {
    const have = fs.readdirSync(dst).length;
    if (have === entries.length && have > 0) return; // 数量一致视为已同步
  }
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d, { skipIfSameCount: e.name === "img" });
    else fs.copyFileSync(s, d);
  }
}

copyDir(SRC, DST);
const imgCount = fs.existsSync(path.join(DST, "questions", "img"))
  ? fs.readdirSync(path.join(DST, "questions", "img")).length
  : 0;
console.log(`content → public/content 就绪(题图 ${imgCount} 张)`);
