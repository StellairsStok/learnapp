import fs from "node:fs";
const out = JSON.parse(fs.readFileSync("C:/Users/chenz/AppData/Local/Temp/claude/C--Users-chenz-Desktop-learnapp/6c64fa0a-47b0-435a-aa18-7d3726a4a82a/tasks/wgmphyse5.output", "utf8"));
for (const id of ["kp-x3-06-002", "kp-x3-10-002"]) {
  const c = out.result.cards.find((x) => x.id === id);
  const lines = c.markdown.split("\n");
  console.log("===== " + id + " =====");
  for (let i = 0; i < lines.length; i++) {
    const n = (lines[i].match(/(?<!\\)\$/g) || []).length;
    if (n % 2 !== 0) console.log("L" + (i + 1) + " (" + n + "$): " + lines[i].slice(0, 180));
  }
}
