import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getJSON } from "../lib/api";
import type { DifficultyLevel, KpTree, StudentPublic } from "../lib/types";

interface LevelCount {
  formal: number;
  cropped: number;
  practice: number;
}

interface KpStat {
  total: number;
  formal: number;
  seeded: number;
  cropped: number;
  practice: number;
  byLevel: Record<DifficultyLevel, LevelCount>;
}

interface Stats {
  perKp: Record<string, KpStat>;
  levelTotals: Record<DifficultyLevel, LevelCount>;
  levelLabels: Record<DifficultyLevel, string>;
  indexTotal: number;
  formalTotal: number;
  practiceTotal: number;
  seedTotal: number;
}

type MasteryLevel = "none" | "learning" | "weak" | "solid";

function levelOf(student: StudentPublic | null, kpId: string): MasteryLevel {
  const m = student?.mastery?.[kpId];
  if (!m || m.seen === 0) return "none";
  if (m.wrong > m.correct) return "weak";
  if (m.correct >= 4 && m.correct >= m.wrong * 3) return "solid";
  return "learning";
}

const LEVEL_LABEL: Record<MasteryLevel, string> = {
  none: "未学",
  learning: "学习中",
  weak: "薄弱",
  solid: "较稳",
};

const DIFFICULTY_LEVELS: { value: DifficultyLevel | null; label: string }[] = [
  { value: null, label: "全部" },
  { value: "basic", label: "基础" },
  { value: "advanced", label: "拔高" },
  { value: "challenge", label: "压轴" },
];

const DIFFICULTY_LEVEL_LABEL: Record<DifficultyLevel, string> = {
  basic: "基础",
  advanced: "拔高",
  challenge: "压轴",
};

function parseDifficultyLevel(value: string | null): DifficultyLevel | null {
  return value === "basic" || value === "advanced" || value === "challenge" ? value : null;
}

export default function MapPage() {
  const [params, setParams] = useSearchParams();
  const difficultyLevel = parseDifficultyLevel(params.get("level"));
  const [tree, setTree] = useState<KpTree | null>(null);
  const [student, setStudent] = useState<StudentPublic | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJSON<KpTree>("/api/content/tree").then(setTree).catch(() => setError("知识树加载失败(content/tree/kp-tree.json)"));
    getJSON<StudentPublic>("/api/student").then(setStudent).catch(() => {});
    getJSON<Stats>("/api/questions/stats").then(setStats).catch(() => {});
  }, []);

  if (error) return <div className="page"><header className="page-head"><h1>学习地图</h1></header><p className="empty">{error}</p></div>;
  if (!tree) return <div className="page"><header className="page-head"><h1>学习地图</h1></header><p className="empty">加载中…</p></div>;

  const activeTotal = difficultyLevel ? stats?.levelTotals?.[difficultyLevel] : null;
  const activePractice = difficultyLevel ? activeTotal?.practice : stats?.practiceTotal;
  const activeFormal = difficultyLevel ? activeTotal?.formal : stats?.formalTotal;
  const activeDifficultyLabel = difficultyLevel ? DIFFICULTY_LEVEL_LABEL[difficultyLevel] : "全部难度";
  const setDifficulty = (nextLevel: DifficultyLevel | null) => {
    const nextParams: Record<string, string> = {};
    if (nextLevel) nextParams.level = nextLevel;
    setParams(nextParams);
  };
  const practiceUrlFor = (kpId: string) => {
    const query = new URLSearchParams({ kp: kpId });
    if (difficultyLevel) query.set("level", difficultyLevel);
    return `/practice?${query.toString()}`;
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>学习地图</h1>
          <div className="head-sub">
            {tree.scope} · 41 个知识单位 · {activeDifficultyLabel} · 可练 {activePractice ?? "—"}/{activeFormal ?? "—"} 题
          </div>
        </div>
        <div className="map-head-tools">
          <div className="legend">
            {(["none", "learning", "weak", "solid"] as MasteryLevel[]).map((l) => (
              <span key={l} className="legend-item">
                <span className={`dot dot-${l}`} /> {LEVEL_LABEL[l]}
              </span>
            ))}
          </div>
          <div className="difficulty-filter" role="group" aria-label="难度筛选">
            {DIFFICULTY_LEVELS.map((item) => {
              const count = item.value ? stats?.levelTotals?.[item.value]?.practice : stats?.practiceTotal;
              return (
                <button
                  key={item.value ?? "all"}
                  type="button"
                  className={`difficulty-chip${difficultyLevel === item.value ? " on" : ""}`}
                  onClick={() => setDifficulty(item.value)}
                >
                  <span>{item.label}</span>
                  <span className="difficulty-chip-count">{count ?? "—"}</span>
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {tree.chapters.map((ch) => (
        <section key={ch.id} className="chapter">
          <h2 className="chapter-title">{ch.name}</h2>
          <div className="unit-grid">
            {ch.units.map((u) => (
              <div key={u.id} className="unit-card">
                <div className="unit-head">
                  <span className="unit-name">{u.name}</span>
                  <span className="unit-pages">{u.pages}</span>
                </div>
                <ul className="kp-list">
                  {u.kps.map((kp) => {
                    const lv = levelOf(student, kp.id);
                    const qs = stats?.perKp?.[kp.id];
                    const levelQs = difficultyLevel && qs ? qs.byLevel?.[difficultyLevel] : null;
                    const countText = qs
                      ? difficultyLevel
                        ? `${levelQs?.practice ?? 0}/${levelQs?.formal ?? 0}`
                        : qs.formal > 0
                          ? `${qs.practice}/${qs.formal}`
                          : qs.total
                      : null;
                    return (
                      <li key={kp.id} className="kp-row">
                        <span className={`dot dot-${lv}`} title={LEVEL_LABEL[lv]} />
                        <span className="kp-name">
                          {kp.name}
                          {kp.type === "实验" && <span className="kp-tag">实验</span>}
                        </span>
                        <span className="kp-actions">
                          {countText !== null && (
                            <span className="kp-count" title={difficultyLevel ? `${activeDifficultyLabel}可练题量 / ${activeDifficultyLabel}正式题量` : "可练题量 / 正式题量"}>
                              {countText}
                            </span>
                          )}
                          <Link className="kp-btn" to={`/?kp=${kp.id}`}>学</Link>
                          <Link className="kp-btn" to={practiceUrlFor(kp.id)}>练</Link>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
