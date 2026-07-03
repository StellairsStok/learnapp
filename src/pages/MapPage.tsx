import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getJSON } from "../lib/api";
import type { KpTree, StudentPublic } from "../lib/types";

interface Stats {
  perKp: Record<string, { total: number; seeded: number }>;
  indexTotal: number;
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

export default function MapPage() {
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

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>学习地图</h1>
          <div className="head-sub">{tree.scope} · 41 个知识单位 · 题库索引 {stats?.indexTotal ?? "…"} 题</div>
        </div>
        <div className="legend">
          {(["none", "learning", "weak", "solid"] as MasteryLevel[]).map((l) => (
            <span key={l} className="legend-item">
              <span className={`dot dot-${l}`} /> {LEVEL_LABEL[l]}
            </span>
          ))}
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
                    return (
                      <li key={kp.id} className="kp-row">
                        <span className={`dot dot-${lv}`} title={LEVEL_LABEL[lv]} />
                        <span className="kp-name">
                          {kp.name}
                          {kp.type === "实验" && <span className="kp-tag">实验</span>}
                        </span>
                        <span className="kp-actions">
                          {qs && <span className="kp-count" title="索引题量 / 已录题干">{qs.seeded > 0 ? `${qs.seeded}/${qs.total}` : qs.total}</span>}
                          <Link className="kp-btn" to={`/?kp=${kp.id}`}>学</Link>
                          <Link className="kp-btn" to={`/practice?kp=${kp.id}`}>练</Link>
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
