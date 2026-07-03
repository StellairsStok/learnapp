import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Md from "../components/Md";
import { getJSON, postJSON } from "../lib/api";
import type { KpTree, PracticeQuestion } from "../lib/types";

interface AnswerResult {
  correct: boolean;
  answer: string;
  rationale: string;
  review_status: string;
}

const DIFF_LABEL: Record<string, string> = {
  D1: "概念直用",
  D2: "基础综合",
  D3: "常规综合",
  D4: "建模迁移",
  D5: "压轴",
};

export default function PracticePage() {
  const [params, setParams] = useSearchParams();
  const kp = params.get("kp");
  const qid = params.get("qid");

  const [q, setQ] = useState<PracticeQuestion | null>(null);
  const [emptyReason, setEmptyReason] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [kpNames, setKpNames] = useState<Record<string, string>>({});
  const loadSeq = useRef(0);

  useEffect(() => {
    getJSON<KpTree>("/api/content/tree")
      .then((tree) => {
        const names: Record<string, string> = {};
        for (const ch of tree.chapters) for (const u of ch.units) for (const k of u.kps) names[k.id] = k.name;
        setKpNames(names);
      })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current; // 过期请求防护:kp/qid 快速切换时丢弃旧响应
    setQ(null);
    setChosen([]);
    setResult(null);
    setSubmitting(false);
    setEmptyReason(null);
    const query = qid ? `qid=${qid}` : kp ? `kp=${kp}` : "";
    const data = await getJSON<{ question: PracticeQuestion | null; reason?: string }>(
      `/api/practice/next${query ? "?" + query : ""}`,
    ).catch(() => ({ question: null, reason: "服务未连接" }));
    if (seq !== loadSeq.current) return;
    if (data.question) setQ(data.question);
    else setEmptyReason(data.reason ?? "暂无可用题目");
  }, [kp, qid]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (letter: string) => {
    if (result || !q?.answerable) return;
    if (q?.multi) {
      setChosen((c) => (c.includes(letter) ? c.filter((x) => x !== letter) : [...c, letter].sort()));
    } else {
      setChosen([letter]);
    }
  };

  const submit = async () => {
    if (!q || !q.answerable || chosen.length === 0 || submitting || result) return; // 防双击重复计分
    setSubmitting(true);
    try {
      const r = await postJSON<AnswerResult>("/api/practice/answer", { qid: q.qid, given: chosen });
      setResult(r);
    } catch {
      setEmptyReason("提交失败:服务未连接。启动应用后重试。");
    } finally {
      setSubmitting(false);
    }
  };

  const next = () => {
    if (qid) setParams(kp ? { kp } : {});
    else void load();
  };

  return (
    <div className="page practice-page">
      <header className="page-head">
        <div>
          <h1>练习</h1>
          <div className="head-sub">
            {kp ? (
              <>
                考点筛选:{kpNames[kp] ?? kp} · <Link to="/practice" className="inline-link">取消筛选</Link>
              </>
            ) : (
              "智能推荐 · 从已录入的讲义真题中选题"
            )}
          </div>
        </div>
        <Link to="/map" className="ghost-btn">按考点选题</Link>
      </header>

      {emptyReason && (
        <div className="panel empty-panel">
          <p>{emptyReason}</p>
          {kp && (
            <p>
              这个考点在索引里有题,但题干文本还没录入。可以先
              <Link to="/practice" className="inline-link">做不限考点的推荐题</Link>,或去
              <Link to={`/?kp=${kp}`} className="inline-link">让 Stellairs 讲这个考点</Link>。
            </p>
          )}
        </div>
      )}

      {q && (
        <div className="panel question-panel">
          <div className="q-meta">
            <span className="q-tag q-source">讲义 p{q.page} · {q.label}</span>
            {q.kp_primary && <span className="q-tag">{kpNames[q.kp_primary] ?? q.kp_primary}</span>}
            {q.difficulty && <span className="q-tag">{DIFF_LABEL[q.difficulty] ?? q.difficulty}</span>}
            <span className="q-tag">{q.choice ? (q.multi ? "多选" : "单选") : q.qtype}</span>
          </div>

          {q.kind === "image" && q.image ? (
            <div className="q-image-wrap">
              <img className="q-image" src={q.image} alt={`${q.label} 题图`} />
            </div>
          ) : (
            <>
              <div className="q-stem">
                <Md>{q.stem_md ?? ""}</Md>
              </div>

              <div className="q-options">
                {Object.entries(q.options ?? {}).map(([letter, text]) => {
                  const isChosen = chosen.includes(letter);
                  const isAnswer = result?.answer.includes(letter) ?? false;
                  let cls = "option";
                  if (result) {
                    if (isAnswer) cls += " right";
                    else if (isChosen) cls += " wrong";
                  } else if (isChosen) cls += " chosen";
                  return (
                    <button key={letter} className={cls} onClick={() => toggle(letter)} disabled={Boolean(result)}>
                      <span className="option-letter">{letter}</span>
                      <span className="option-text">
                        <Md>{text}</Md>
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {!result && !q.answerable ? (
            <div className="q-actions image-actions">
              <Link className="primary-btn" to={`/?q=${q.qid}${q.kp_primary ? `&kp=${q.kp_primary}` : ""}`}>
                让 Stellairs 讲这题
              </Link>
              <button className="ghost-btn" onClick={next}>下一题</button>
              <span className="q-hint">这批题先接入题图，答案未挂接，暂不自动判分。</span>
            </div>
          ) : !result ? (
            <div className="q-actions">
              <button className="primary-btn" disabled={chosen.length === 0 || submitting} onClick={() => void submit()}>
                {submitting ? "判分中…" : "提交答案"}
              </button>
              {q.multi && <span className="q-hint">多选题:选出全部正确项</span>}
            </div>
          ) : (
            <div className={"verdict " + (result.correct ? "ok" : "no")}>
              <div className="verdict-title">{result.correct ? "回答正确" : `不对 · 正确答案 ${result.answer}`}</div>
              <div className="verdict-rationale">
                <Md>{result.rationale}</Md>
              </div>
              {result.review_status === "pending" && (
                <div className="verdict-note">此题答案为 AI 起草、待教研终审;发现有误请记下 p{q.page} {q.label}。</div>
              )}
              <div className="q-actions">
                <button className="primary-btn" onClick={next}>下一题</button>
                {!result.correct && q.kp_primary && (
                  <Link className="ghost-btn" to={`/?kp=${q.kp_primary}`}>让 Stellairs 讲讲这个考点</Link>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
