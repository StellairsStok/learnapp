// 构建打标输入:节标题继承 + 每页题目清单;并导出 55 考点简表。
import fs from "node:fs";

const vision = JSON.parse(fs.readFileSync("tmp/wb1-vision.json", "utf8"));
const manifest = JSON.parse(fs.readFileSync("scripts/data/wb1-crop-manifest.json", "utf8"));

let lastHeader = "";
const pages = [];
for (const v of vision.pages.sort((a, b) => a.wbPage - b.wbPage)) {
  let header = v.sectionHeader || "";
  if (/^续上页/.test(header) || header === "") header = lastHeader + "(续)";
  else lastHeader = header;
  const qs = manifest.items.filter((i) => i.wbPage === v.wbPage).sort((a, b) => a.qid.localeCompare(b.qid));
  if (qs.length === 0) continue;
  pages.push({
    wbPage: v.wbPage,
    printedPage: v.wbPage - 3,
    pageKind: v.pageKind,
    section: header,
    notes: v.notes || "",
    questions: qs.map((q) => ({ qid: q.qid, n: q.n, column: q.column })),
  });
}
fs.writeFileSync("tmp/wb1-tag-input.json", JSON.stringify({ pages }, null, 1));
console.log("打标输入就绪:", pages.length, "页,", pages.reduce((s, p) => s + p.questions.length, 0), "题");

const tree = JSON.parse(fs.readFileSync("content/tree/kp-tree.json", "utf8"));
const lines = [];
for (const ch of tree.chapters)
  for (const u of ch.units)
    for (const k of u.kps) lines.push(k.id + " " + k.name.replace(/\$[^$]*\$/g, "").slice(0, 34));
fs.writeFileSync("tmp/kp-list.txt", lines.join("\n"));
console.log("考点简表:", lines.length, "条");
