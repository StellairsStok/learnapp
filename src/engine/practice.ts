// 练习引擎(客户端):选题池、判分、学情统计、单题元信息。取代原 server 练习端点。
import {
  getCrops,
  getKpMap,
  getQuestionIndex,
  getSeeds,
  questionImageUrl,
  questionSourceLabel,
  type SeedQuestion,
} from "./content";
import { getStudent, saveStudent, touchMastery } from "./store";

export type DifficultyLevel = "basic" | "advanced" | "challenge";
const DIFFICULTY_LEVELS: DifficultyLevel[] = ["basic", "advanced", "challenge"];
const DIFFICULTY_LEVEL_LABEL: Record<DifficultyLevel, string> = {
  basic: "基础",
  advanced: "拔高",
  challenge: "压轴",
};

function difficultyLevelOf(d?: string | null): DifficultyLevel {
  if (d === "D4" || d === "D5") return "challenge";
  if (d === "D3") return "advanced";
  return "basic";
}
function parseLevel(raw: string | null): DifficultyLevel | null {
  return raw && (DIFFICULTY_LEVELS as string[]).includes(raw) ? (raw as DifficultyLevel) : null;
}
function emptyBuckets() {
  return {
    basic: { formal: 0, cropped: 0, practice: 0 },
    advanced: { formal: 0, cropped: 0, practice: 0 },
    challenge: { formal: 0, cropped: 0, practice: 0 },
  } satisfies Record<DifficultyLevel, { formal: number; cropped: number; practice: number }>;
}

interface Candidate {
  kind: "text" | "image";
  qid: string;
  page: number;
  label: string;
  qtype: string;
  multi: boolean;
  choice: boolean;
  kp_primary?: string;
  kp_secondary?: string[];
  stage?: string;
  difficulty?: string;
  difficultyLevel: DifficultyLevel;
  answerable: boolean;
  stem_md?: string;
  options?: Record<string, string>;
  review_status?: string;
  image?: string;
  source?: string;
  sourceLabel: string;
}

let poolCache: Candidate[] | null = null;
let seedCache: SeedQuestion[] | null = null;

async function pool(): Promise<Candidate[]> {
  if (poolCache) return poolCache;
  const seeds = await getSeeds();
  seedCache = seeds;
  const crops = await getCrops();
  const index = await getQuestionIndex();
  const seedQids = new Set(seeds.map((x) => x.qid!));
  const cands: Candidate[] = [];
  for (const q of seeds) {
    cands.push({
      kind: "text",
      qid: q.qid!,
      page: q.page,
      label: q.label,
      qtype: q.qtype,
      multi: (q.qtype ?? "").includes("多"),
      choice: true,
      kp_primary: q.kp_primary,
      stage: q.stage,
      difficulty: q.difficulty,
      difficultyLevel: difficultyLevelOf(q.difficulty),
      answerable: true,
      stem_md: q.stem_md,
      options: q.options,
      review_status: q.review_status,
      sourceLabel: questionSourceLabel(q.qid!, q.page),
    });
  }
  for (const q of index) {
    if (q.informal || seedQids.has(q.qid) || !crops[q.qid]) continue;
    cands.push({
      kind: "image",
      qid: q.qid,
      page: q.page,
      label: q.label,
      qtype: q.qtype,
      multi: q.qtype.includes("多"),
      choice: /选/.test(q.qtype),
      kp_primary: q.kp_primary,
      kp_secondary: q.kp_secondary,
      stage: q.stage,
      difficulty: q.difficulty,
      difficultyLevel: difficultyLevelOf(q.difficulty),
      answerable: false,
      image: questionImageUrl(crops[q.qid].file),
      source: q.source,
      sourceLabel: questionSourceLabel(q.qid, q.page),
    });
  }
  poolCache = cands;
  return cands;
}

/** 该考点在题库里有没有可呈现的题(第四章等无讲义章节没有题库) */
export async function hasPracticeFor(kp: string | null | undefined): Promise<boolean> {
  if (!kp) return false;
  const all = await pool();
  return all.some((x) => x.kp_primary === kp || x.kp_secondary?.includes(kp));
}

export async function nextQuestion(params: URLSearchParams): Promise<{ question: Candidate | null; reason?: string }> {
  const kp = params.get("kp");
  const qid = params.get("qid");
  const level = parseLevel(params.get("level"));
  const excluded = new Set(
    (params.get("exclude") ?? "").split(",").map((x) => x.trim()).filter(Boolean),
  );
  const s = getStudent();
  const all = await pool();

  if (qid) {
    const hit = all.find((x) => x.qid === qid);
    return hit ? { question: hit } : { question: null, reason: "题目不存在" };
  }

  const matchesKp = (x: Candidate) => !kp || x.kp_primary === kp || x.kp_secondary?.includes(kp);
  const matchesLevel = (x: Candidate) => !level || x.difficultyLevel === level;
  let p = all.filter((x) => matchesKp(x) && matchesLevel(x));
  if (p.length === 0) {
    const lbl = level ? DIFFICULTY_LEVEL_LABEL[level] : null;
    return {
      question: null,
      reason: kp
        ? lbl
          ? `该考点暂时没有${lbl}档可练题。`
          : "该考点暂时没有可呈现的题(截图与题干都缺)"
        : lbl
          ? `题库里暂时没有${lbl}档可练题。`
          : "题库为空",
    };
  }
  if (excluded.size > 0) {
    const nextP = p.filter((x) => !excluded.has(x.qid));
    if (nextP.length === 0) {
      p = all.filter((x) => matchesLevel(x) && !excluded.has(x.qid));
      if (p.length === 0) p = all.filter(matchesLevel);
      if (p.length === 0) p = all;
    } else p = nextP;
  }
  const fresh = p.filter((x) => !(x.qid in s.answers));
  if (fresh.length > 0) p = fresh;
  const rank: Record<string, number> = { D1: 1, D2: 2, D3: 3, D4: 4, D5: 5 };
  p.sort(
    (a, b) =>
      (rank[a.difficulty ?? "D3"] ?? 3) - (rank[b.difficulty ?? "D3"] ?? 3) ||
      Number(b.answerable) - Number(a.answerable),
  );
  const top = p.slice(0, Math.min(3, p.length));
  return { question: top[Math.floor(Math.random() * top.length)] };
}

export async function gradeAnswer(qid: string, given: string[]): Promise<{ correct?: boolean; answer?: string; rationale?: string; review_status?: string; error?: string }> {
  const seeds = seedCache ?? (await getSeeds());
  const q = seeds.find((x) => x.qid === qid);
  if (!q) return { error: "题目不存在" };
  const answer = String(q.answer_draft ?? "").toUpperCase().replace(/[^A-D]/g, "").split("").filter(Boolean);
  if (answer.length === 0) return { error: "该题答案待录入,暂不能判分" };
  const chosen = [...new Set((Array.isArray(given) ? given : []).map((g) => String(g).toUpperCase()).filter((g) => /^[A-D]$/.test(g)))].sort();
  if (chosen.length === 0) return { error: "没有有效的选项" };
  const correct = answer.slice().sort().join("") === chosen.join("");

  const s = getStudent();
  s.answers[qid] = { correct, given: chosen.join(""), at: new Date().toISOString() };
  if (q.kp_primary) touchMastery(s, q.kp_primary, correct);
  if (!correct) {
    s.mistakes.unshift({
      qid,
      page: q.page,
      label: q.label,
      kp: q.kp_primary ?? null,
      stem: q.stem_md.slice(0, 80),
      given: chosen.join(""),
      answer: answer.join(""),
      at: new Date().toISOString(),
    });
  }
  saveStudent(s);
  return { correct, answer: answer.join(""), rationale: q.rationale_draft, review_status: q.review_status };
}

export async function questionMeta(qid: string): Promise<unknown> {
  const q = (await getQuestionIndex()).find((x) => x.qid === qid);
  if (!q) return { error: "题目不存在" };
  const crop = (await getCrops())[qid];
  const kpName = (await getKpMap()).get(q.kp_primary)?.name ?? q.kp_primary;
  return {
    qid,
    page: q.page,
    label: q.label,
    qtype: q.qtype,
    kp_primary: q.kp_primary,
    kpName,
    image: crop ? questionImageUrl(crop.file) : null,
    sourceLabel: questionSourceLabel(qid, q.page),
  };
}

export async function stats(): Promise<unknown> {
  const index = await getQuestionIndex();
  const seeds = await getSeeds();
  const crops = await getCrops();
  const seedQids = new Set(seeds.map((x) => x.qid).filter(Boolean));
  type KpStats = {
    total: number;
    formal: number;
    seeded: number;
    cropped: number;
    practice: number;
    byLevel: Record<DifficultyLevel, { formal: number; cropped: number; practice: number }>;
  };
  const newStats = (): KpStats => ({ total: 0, formal: 0, seeded: 0, cropped: 0, practice: 0, byLevel: emptyBuckets() });
  const levelTotals = emptyBuckets();
  const perKp: Record<string, KpStats> = {};
  const related = (q: { kp_primary?: string; kp_secondary?: string[] }) =>
    [...new Set([q.kp_primary, ...(q.kp_secondary ?? [])].filter(Boolean) as string[])];

  for (const q of index) {
    for (const kp of related(q)) {
      const e = (perKp[kp] ??= newStats());
      e.total += 1;
      if (!q.informal) {
        const lv = difficultyLevelOf(q.difficulty);
        e.formal += 1;
        e.byLevel[lv].formal += 1;
        if (crops[q.qid]) { e.cropped += 1; e.byLevel[lv].cropped += 1; }
        if (seedQids.has(q.qid) || crops[q.qid]) { e.practice += 1; e.byLevel[lv].practice += 1; }
      }
    }
  }
  for (const s of seeds) for (const kp of related(s)) (perKp[kp] ??= newStats()).seeded += 1;
  const formalQs = index.filter((q) => !q.informal);
  for (const q of formalQs) {
    const lv = difficultyLevelOf(q.difficulty);
    levelTotals[lv].formal += 1;
    if (crops[q.qid]) levelTotals[lv].cropped += 1;
    if (seedQids.has(q.qid) || crops[q.qid]) levelTotals[lv].practice += 1;
  }
  return {
    perKp,
    levelTotals,
    levelLabels: DIFFICULTY_LEVEL_LABEL,
    indexTotal: index.length,
    formalTotal: formalQs.length,
    practiceTotal: formalQs.filter((q) => seedQids.has(q.qid) || crops[q.qid]).length,
    seedTotal: seeds.length,
  };
}
