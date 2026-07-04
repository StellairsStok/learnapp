// 客户端内容加载器:从静态资源(GitHub Pages 上的 content/)fetch,带缓存。
// 取代原 server/lib/content.ts。
import { ASSET_BASE } from "../config";

function url(rel: string): string {
  return ASSET_BASE + "content/" + rel;
}

const cache = new Map<string, unknown>();

async function loadJson<T>(rel: string): Promise<T | null> {
  if (cache.has(rel)) return cache.get(rel) as T;
  try {
    const r = await fetch(url(rel));
    if (!r.ok) return null;
    const j = (await r.json()) as T;
    cache.set(rel, j);
    return j;
  } catch {
    return null;
  }
}

async function loadText(rel: string): Promise<string | null> {
  const key = "TEXT:" + rel;
  if (cache.has(key)) return cache.get(key) as string;
  try {
    const r = await fetch(url(rel));
    if (!r.ok) return null;
    const t = await r.text();
    cache.set(key, t);
    return t;
  } catch {
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

export function getTree(): Promise<KpTree | null> {
  return loadJson<KpTree>("tree/kp-tree.json");
}

export async function getKpMap(): Promise<Map<string, Kp & { unitName: string }>> {
  const map = new Map<string, Kp & { unitName: string }>();
  const tree = await getTree();
  if (!tree) return map;
  for (const ch of tree.chapters)
    for (const u of ch.units) for (const kp of u.kps) map.set(kp.id, { ...kp, unitName: u.name });
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

export async function getQuestionIndex(): Promise<IndexQuestion[]> {
  const data = await loadJson<{ questions: IndexQuestion[] }>("questions/index-x3.json");
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
  qid?: string;
  kp_primary?: string;
  stage?: string;
  difficulty?: string;
  situation?: string;
}

export async function getSeeds(): Promise<SeedQuestion[]> {
  const data = await loadJson<{ questions: SeedQuestion[] }>("questions/seed-x3.json");
  if (!data?.questions) return [];
  const index = await getQuestionIndex();
  return data.questions.map((s, i) => {
    const hit = index.find((q) => q.page === s.page && q.label === s.label);
    return {
      ...s,
      qid: hit?.qid ?? `q-x3-p${String(s.page).padStart(3, "0")}-seed${i + 1}`,
      kp_primary: hit?.kp_primary,
      stage: hit?.stage,
      difficulty: hit?.difficulty,
      situation: hit?.situation,
    };
  });
}

// ---------- 策略卡 / 人设 / 知识卡 ----------
function extractInject(md: string | null): string | null {
  if (!md) return null;
  const m = md.match(/##\s*注入提示词\s*\n([\s\S]*?)(?=\n##\s|$)/);
  return m ? m[1].trim() : null;
}

export async function getPedagogyInject(mode: string): Promise<string | null> {
  return extractInject(await loadText(`pedagogy/${mode}.md`));
}
export async function getPersonaInject(): Promise<string | null> {
  return extractInject(await loadText("persona/stellairs.md"));
}
export async function getKnowledgeCard(kpId: string): Promise<string | null> {
  return loadText(`cards/${kpId}.md`);
}

// ---------- 题图裁切清单 ----------
export interface CropsManifest {
  qids: Record<string, { file: string; pages: number[]; confidence: string; label?: string; informal?: boolean }>;
}
export async function getCrops(): Promise<CropsManifest["qids"]> {
  const m = await loadJson<CropsManifest>("questions/crops.json");
  // 兼容 {qids:{...}} 或直接 {...}
  return (m as CropsManifest)?.qids ?? ((m as unknown) as CropsManifest["qids"]) ?? {};
}

/** 题图静态 URL(供 <img> 与视觉读题用) */
export function questionImageUrl(file: string): string {
  return ASSET_BASE + "content/questions/img/" + file;
}

// ---------- 概念配图(从真题裁出的标准图) ----------
export interface Figure {
  id: string;
  file: string;
  caption: string;
  kps: string[];
  keywords: string[];
}
export async function getFigures(): Promise<Figure[]> {
  const m = await loadJson<{ figures: Figure[] }>("figures/manifest.json");
  return m?.figures ?? [];
}
/** 概念配图静态 URL(id 即文件名前缀) */
export function figureUrl(id: string): string {
  return ASSET_BASE + "content/figures/" + id + ".webp";
}
