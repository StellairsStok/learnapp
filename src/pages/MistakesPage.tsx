import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getJSON } from "../lib/api";
import type { KpTree, StudentPublic } from "../lib/types";

export default function MistakesPage() {
  const [student, setStudent] = useState<StudentPublic | null>(null);
  const [kpNames, setKpNames] = useState<Record<string, string>>({});

  useEffect(() => {
    getJSON<StudentPublic>("/api/student").then(setStudent).catch(() => {});
    getJSON<KpTree>("/api/content/tree")
      .then((tree) => {
        const names: Record<string, string> = {};
        for (const ch of tree.chapters) for (const u of ch.units) for (const k of u.kps) names[k.id] = k.name;
        setKpNames(names);
      })
      .catch(() => {});
  }, []);

  const mistakes = student?.mistakes ?? [];
  const unresolved = mistakes.filter((m) => !m.resolvedAt);
  const resolved = mistakes.filter((m) => m.resolvedAt);

  const renderItem = (m: (typeof mistakes)[number]) => (
    <div key={m.qid + m.at} className={"panel mistake-item" + (m.resolvedAt ? " resolved" : "")}>
      <div className="q-meta">
        {m.resolvedAt && <span className="q-tag beaten">✓ 已攻克</span>}
        {m.kp && <span className="q-tag">{kpNames[m.kp] ?? m.kp}</span>}
        <span className="q-tag q-source">{m.qid.startsWith("q-wb1-") ? `必刷题 p${m.page - 3}` : `讲义 p${m.page}`} · {m.label}</span>
        <span className="mistake-time">{new Date(m.at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      <div className="mistake-stem">{m.stem}…</div>
      <div className="mistake-foot">
        <span className="mistake-ans">
          你选了 <b>{m.given || "—"}</b>,正确是 <b>{m.answer}</b>
        </span>
        <span className="kp-actions">
          <Link className="kp-btn" to={`/practice?qid=${m.qid}`}>重练</Link>
          {m.kp && <Link className="kp-btn" to={`/?kp=${m.kp}`}>听讲</Link>}
        </span>
      </div>
    </div>
  );

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>错题本</h1>
          <div className="head-sub">
            待攻克 <b className="hl">{unresolved.length}</b> · 已攻克 {resolved.length} —— 重练做对一道,销一道账
          </div>
        </div>
        {unresolved.length > 0 && (
          <Link to="/practice?source=mistakes" className="primary-btn">一键重练错题</Link>
        )}
      </header>

      {mistakes.length === 0 ? (
        <div className="panel empty-panel">
          <p>还没有错题——这可能是好事,也可能说明练得还不够。</p>
          <Link to="/practice" className="primary-btn" style={{ display: "inline-block", marginTop: 8 }}>
            去练几道
          </Link>
        </div>
      ) : (
        <div className="mistake-list">
          {unresolved.map(renderItem)}
          {resolved.length > 0 && <div className="mistake-divider">已攻克({resolved.length})</div>}
          {resolved.map(renderItem)}
        </div>
      )}
    </div>
  );
}
