import fs from "node:fs";
import path from "node:path";

// 内容资产加载器:所有教研内容都是 content/ 下的可读文件,教研(创始人)改文件即改产品。
// 带 mtime 缓存;文件缺失时返回 null,应用降级运行而不是崩溃。

const CONTENT_ROOT = path.resolve(process.cwd(), "content");

interface CacheEntry {
  mtime: number;
  value: unknown;
}
const cache = new Map<string, CacheEntry>();

function loadFile(relPath: string): string | null {
  const full = path.join(CONTENT_ROOT, relPath);
  try {
    const stat = fs.statSync(full);
    const hit = cache.get(relPath);
    if (hit && hit.mtime === stat.mtimeMs) return hit.value as string;
    const text = fs.readFileSync(full, "utf-8");
    cache.set(relPath, { mtime: stat.mtimeMs, value: text });
    return text;
  } catch {
    return null;
  }
}

function loadJson<T>(relPath: string): T | null {
  const text = loadFile(relPath);
  if (text == null) return null;
  try {
    return JSON.parse(text.replace(/^﻿/, "")) as T;
  } catch (e) {
    console.error(`[content] JSON 解析失败: ${relPath}`, e);
    return null;
  }
}

// ---------- 知识树 ----------

export interface Kp {
  id: string;
  name: string;
  type: string;
  formulas: string[];
  pitfalls: string[];
  pages: string;
}
export interface Unit {
  id: string;
  name: string;
  pages: string;
  kps: Kp[];
}
export interface Chapter {
  id: string;
  name: string;
  units: Unit[];
}
export interface KpTree {
  version: string;
  scope: string;
  chapters: Chapter[];
}

export function getTree(): KpTree | null {
  return loadJson<KpTree>("tree/kp-tree.json");
}

export function getKpMap(): Map<string, Kp & { unitName: string }> {
  const map = new Map<string, Kp & { unitName: string }>();
  const tree = getTree();
  if (!tree) return map;
  for (const ch of tree.chapters)
    for (const u of ch.units)
      for (const kp of u.kps) map.set(kp.id, { ...kp, unitName: u.name });
  return map;
}

// ---------- 题目索引与种子题 ----------

export interface IndexQuestion {
  qid: string;
  page: number;
  section: string;
  label: string;
  qtype: string;
  informal: boolean;
  kp_primary: string;
  kp_secondary: string[];
  models: string[];
  situation: string;
  difficulty: string;
  stage: string;
  has_figure: boolean;
  figure_type: string;
  source_note: string;
  answer_status: string;
}

export function getQuestionIndex(): IndexQuestion[] {
  const data = loadJson<{ questions: IndexQuestion[] }>("questions/index-x3.json");
  return data?.questions ?? [];
}

export interface SeedQuestion {
  page: number;
  label: string;
  qtype: string;
  stem_md: string;
  options: Record<string, string>;
  answer_draft: string;
  rationale_draft: string;
  review_status: string;
  // 与索引连接后补充:
  qid?: string;
  kp_primary?: string;
  kp_secondary?: string[];
  stage?: string;
  difficulty?: string;
  situation?: string;
}

export function getSeeds(): SeedQuestion[] {
  const data = loadJson<{ questions: SeedQuestion[] }>("questions/seed-x3.json");
  if (!data?.questions) return [];
  const index = getQuestionIndex();
  return data.questions.map((s, i) => {
    const hit = index.find((q) => q.page === s.page && q.label === s.label);
    return {
      ...s,
      qid: hit?.qid ?? `q-x3-p${String(s.page).padStart(3, "0")}-seed${i + 1}`,
      kp_primary: hit?.kp_primary,
      kp_secondary: hit?.kp_secondary,
      stage: hit?.stage,
      difficulty: hit?.difficulty,
      situation: hit?.situation,
    };
  });
}

// ---------- 教学策略卡 / 人设 / 知识卡 ----------

/** 从 markdown 中抽出「## 注入提示词」一节的正文(注入模型 system prompt 用) */
function extractInject(md: string | null): string | null {
  if (!md) return null;
  const m = md.match(/##\s*注入提示词\s*\n([\s\S]*?)(?=\n##\s|$)/);
  return m ? m[1].trim() : null;
}

export function getPedagogyInject(mode: string): string | null {
  return extractInject(loadFile(`pedagogy/${mode}.md`));
}

export function getPedagogyCard(mode: string): string | null {
  return loadFile(`pedagogy/${mode}.md`);
}

export function getPersonaInject(): string | null {
  return extractInject(loadFile("persona/stellairs.md"));
}

export function getKnowledgeCard(kpId: string): string | null {
  return loadFile(`cards/${kpId}.md`);
}

// ---------- mock 演示剧本 ----------

export interface MockLesson {
  kp: string;
  kp_name: string;
  direct_lesson: string[];
  check_question: {
    stem: string;
    options: Record<string, string>;
    answer: string;
    feedback_correct: string;
    feedback_wrong: string;
  };
  socratic_ladder: {
    problem: string;
    probe: string;
    hint_thinking: string;
    hint_method: string;
    hint_formula: string;
    solution: string;
    variant: string;
    variant_answer?: string;
  };
  drill_lines: { correct: string[]; wrong_brief: string };
}

export function getMockLesson(): MockLesson | null {
  return loadJson<MockLesson>("mock/lesson-boyle.json");
}

// ---------- 题目截图清单 ----------

export interface CropsManifest {
  generatedAt: string;
  count: number;
  qids: Record<string, { file: string; pages: number[]; confidence: string }>;
}

export function getCrops(): CropsManifest["qids"] {
  return loadJson<CropsManifest>("questions/crops.json")?.qids ?? {};
}
