// 生成第四章知识底座总览 HTML(知识树 + 14张教学卡全文 + 题量分布)
import fs from "node:fs";

const OUT = "C:/Users/chenz/AppData/Local/Temp/claude/C--Users-chenz-Desktop-learnapp/6c64fa0a-47b0-435a-aa18-7d3726a4a82a/scratchpad/ch4-knowledge.html";
const tree = JSON.parse(fs.readFileSync("content/tree/kp-tree.json", "utf8"));
const index = JSON.parse(fs.readFileSync("content/questions/index-x3.json", "utf8"));
const ch4 = tree.chapters.find((c) => c.id === "ch4");

// 每考点题量(必刷题 wb1)
const qCount = {};
for (const q of index.questions) {
  for (const kp of [q.kp_primary, ...(q.kp_secondary || [])]) {
    if (kp && kp.match(/kp-x3-1[5-9]/)) qCount[kp] = (qCount[kp] || 0) + 1;
  }
}

// LaTeX → 可读文本(近似渲染,给非技术读者)
const SUB = { 0: "₀", 1: "₁", 2: "₂", 3: "₃", 4: "₄", m: "ₘ", n: "ₙ", c: "c", k: "k" };
function tex(s) {
  let t = s;
  t = t.replace(/\$\$([\s\S]*?)\$\$/g, (_, x) => `<div class="fx">${cvt(x)}</div>`);
  t = t.replace(/\$([^$]*?)\$/g, (_, x) => `<span class="fx-i">${cvt(x)}</span>`);
  return t;
}
function cvt(x) {
  return x
    .replace(/\\dfrac\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)")
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)")
    .replace(/\\sqrt\[3\]\{([^{}]+)\}/g, "³√($1)")
    .replace(/\\sqrt\{([^{}]+)\}/g, "√($1)")
    .replace(/\\mathrm\{([^{}]*)\}/g, "$1")
    .replace(/\\text\{([^{}]*)\}/g, "$1")
    .replace(/\\times/g, "×").replace(/\\cdot/g, "·")
    .replace(/\\nu/g, "ν").replace(/\\lambda/g, "λ").replace(/\\varepsilon/g, "ε")
    .replace(/\\Delta/g, "Δ").replace(/\\pi/g, "π").replace(/\\rho/g, "ρ").replace(/\\alpha/g, "α").replace(/\\beta/g, "β").replace(/\\gamma/g, "γ").replace(/\\infty/g, "∞")
    .replace(/\\geq?/g, "≥").replace(/\\leq?/g, "≤").replace(/\\approx/g, "≈").replace(/\\to|\\rightarrow|\\Rightarrow/g, "→").replace(/\\sim/g, "~").replace(/\\pm/g, "±")
    .replace(/\^\{([^{}]+)\}/g, "<sup>$1</sup>").replace(/\^(\S)/g, "<sup>$1</sup>")
    .replace(/_\{([^{}]+)\}/g, "<sub>$1</sub>").replace(/_(\S)/g, "<sub>$1</sub>")
    .replace(/\\left|\\right/g, "").replace(/\\,|\\;|\\!|\\ /g, " ").replace(/\\\\/g, " ")
    .replace(/\\[a-zA-Z]+/g, "");
}

// markdown 卡片 → HTML(轻量转换)
function mdToHtml(md) {
  const body = md.replace(/^---[\s\S]*?---\s*/, "");
  const lines = body.split("\n");
  let html = "", inList = false, inTable = false;
  const flush = () => { if (inList) { html += "</ul>"; inList = false; } if (inTable) { html += "</table>"; inTable = false; } };
  for (const raw of lines) {
    const l = raw.trimEnd();
    if (/^## /.test(l)) { flush(); html += `<h4>${l.slice(3)}</h4>`; continue; }
    if (/^\|/.test(l)) {
      if (/^\|[\s:-]+\|/.test(l.replace(/\|/g, "|"))) continue; // 分隔行
      if (/^\|[-\s|:]+$/.test(l)) continue;
      if (!inTable) { html += "<table>"; inTable = true; }
      const cells = l.split("|").slice(1, -1).map((c) => tex(esc(c.trim())));
      html += "<tr>" + cells.map((c) => `<td>${c}</td>`).join("") + "</tr>";
      continue;
    }
    if (/^[-*] |^\d+\. |^[①-⑩]/.test(l.trim())) {
      if (inTable) { html += "</table>"; inTable = false; }
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${fmt(l.trim().replace(/^[-*] |^\d+\. /, ""))}</li>`;
      continue;
    }
    if (l.trim() === "") { flush(); continue; }
    flush();
    html += `<p>${fmt(l.trim())}</p>`;
  }
  flush();
  return html;
}
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (s) => tex(esc(s)).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>");

let sections = "";
let kpTotal = 0;
for (const u of ch4.units) {
  let kpHtml = "";
  for (const k of u.kps) {
    kpTotal++;
    const cardPath = `content/cards/${k.id}.md`;
    const card = fs.existsSync(cardPath) ? fs.readFileSync(cardPath, "utf8") : "";
    const n = qCount[k.id] || 0;
    kpHtml += `
    <details class="kp">
      <summary><span class="kp-name">${esc(k.name)}</span>
        <span class="meta"><span class="tag">${k.type}</span><span class="tag q">${n} 题</span><span class="tag ok">已终审</span></span>
      </summary>
      <div class="card-body">${mdToHtml(card)}</div>
    </details>`;
  }
  sections += `<section><h3>${esc(u.name)} <span class="ucount">${u.kps.length} 个考点</span></h3>${kpHtml}</section>`;
}

const wb1ch4 = index.questions.filter((q) => q.source === "wb1" && /kp-x3-1[5-9]/.test(q.kp_primary));
const dh = { D1: 0, D2: 0, D3: 0, D4: 0, D5: 0 };
wb1ch4.forEach((q) => dh[q.difficulty]++);

const html = `<title>第四章·原子结构和波粒二象性 — 知识底座总览</title>
<style>
:root { --ink:#e9eef7; --ink2:#aeb9cc; --ink3:#7b8598; --bg:#0f1420; --panel:#141a28; --line:rgba(206,220,240,.12); --zhu:#ec6152; --jade:#5fa98a; --gold:#cca85f; }
@media (prefers-color-scheme: light) { :root { --ink:#22293a; --ink2:#4a5468; --ink3:#8a93a5; --bg:#f7f8fb; --panel:#fff; --line:rgba(30,40,70,.12); } }
:root[data-theme="light"] { --ink:#22293a; --ink2:#4a5468; --ink3:#8a93a5; --bg:#f7f8fb; --panel:#fff; --line:rgba(30,40,70,.12); }
:root[data-theme="dark"] { --ink:#e9eef7; --ink2:#aeb9cc; --ink3:#7b8598; --bg:#0f1420; --panel:#141a28; --line:rgba(206,220,240,.12); }
* { box-sizing:border-box; }
body { background:var(--bg); }
.wrap { max-width:860px; margin:0 auto; padding:40px 20px 90px; color:var(--ink); font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif; line-height:1.75; font-size:15.5px; }
h1 { font-size:clamp(24px,4.5vw,34px); margin:0 0 6px; }
.sub { color:var(--ink3); margin:0 0 22px; font-size:14px; }
.stats { display:flex; flex-wrap:wrap; gap:10px; margin:0 0 30px; }
.stat { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:10px 16px; font-size:13.5px; color:var(--ink2); }
.stat b { color:var(--zhu); font-size:17px; margin-right:4px; }
section { margin-top:34px; }
h3 { font-size:19px; border-left:4px solid var(--zhu); padding-left:12px; margin:0 0 14px; }
.ucount { color:var(--ink3); font-size:13px; font-weight:400; margin-left:8px; }
details.kp { background:var(--panel); border:1px solid var(--line); border-radius:12px; margin-bottom:10px; overflow:hidden; }
summary { padding:13px 16px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; gap:10px; list-style:none; }
summary::-webkit-details-marker { display:none; }
summary:hover { background:rgba(236,97,82,.05); }
.kp-name { font-weight:600; }
.meta { display:flex; gap:6px; flex-shrink:0; }
.tag { font-size:11.5px; padding:2px 9px; border-radius:999px; border:1px solid var(--line); color:var(--ink3); white-space:nowrap; }
.tag.q { color:var(--gold); border-color:rgba(204,168,95,.4); }
.tag.ok { color:var(--jade); border-color:rgba(95,169,138,.4); }
.card-body { padding:4px 20px 18px; border-top:1px solid var(--line); }
.card-body h4 { color:var(--zhu); font-size:15px; margin:18px 0 8px; }
.card-body p { margin:7px 0; color:var(--ink2); }
.card-body p b, .card-body li b { color:var(--ink); }
.card-body ul { margin:6px 0; padding-left:22px; color:var(--ink2); }
.card-body li { margin:5px 0; }
.fx { background:rgba(236,97,82,.06); border:1px solid var(--line); border-radius:8px; padding:8px 14px; margin:8px 0; font-family:"STIX Two Math","Cambria Math",Georgia,serif; overflow-x:auto; }
.fx-i { font-family:"STIX Two Math","Cambria Math",Georgia,serif; }
table { border-collapse:collapse; margin:10px 0; font-size:13.5px; display:block; overflow-x:auto; }
td { border:1px solid var(--line); padding:6px 10px; color:var(--ink2); }
code { background:rgba(206,220,240,.08); border-radius:4px; padding:1px 5px; font-size:13px; }
.hint { color:var(--ink3); font-size:13px; margin-top:26px; }
</style>
<div class="wrap">
<h1>第四章 · 原子结构和波粒二象性</h1>
<p class="sub">Stellairs 知识底座总览 — 知识树 + 全部教学卡(衡中学案加深版·已终审)+ 题库覆盖</p>
<div class="stats">
  <div class="stat"><b>${ch4.units.length}</b>个单元</div>
  <div class="stat"><b>${kpTotal}</b>个考点(全部有卡)</div>
  <div class="stat"><b>${wb1ch4.length}</b>道必刷题(D1:${dh.D1} D2:${dh.D2} D3:${dh.D3} D4:${dh.D4} D5:${dh.D5})</div>
  <div class="stat"><b>5</b>张真题概念配图</div>
</div>
${sections}
<p class="hint">点击任意考点展开完整教学卡(定义与规律 / 核心公式 / 物理直觉 / 最小例子 / 常见误区 / 超纲边界 / 前置知识 / 关联题型 / 讲法要点)。公式为便于阅读做了轻量转写,AI 教学时使用的是原始 LaTeX 版本。</p>
</div>`;

fs.writeFileSync(OUT, html);
console.log("生成:", OUT, Math.round(html.length / 1024) + "KB");
