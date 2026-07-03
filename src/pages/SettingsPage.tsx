import { useEffect, useState } from "react";
import { getJSON, postJSON, setStudentCode, studentCode } from "../lib/api";
import type { Health, StudentPublic } from "../lib/types";

const QUESTIONS = [
  {
    key: "newConcept" as const,
    title: "学新东西时",
    options: [
      { value: "listen", label: "先听讲解" },
      { value: "try", label: "先试着做" },
    ],
  },
  {
    key: "onWrong" as const,
    title: "做错题时",
    options: [
      { value: "explain", label: "直接讲哪错了" },
      { value: "guided", label: "引导我自己找" },
    ],
  },
  {
    key: "practice" as const,
    title: "练习节奏",
    options: [
      { value: "drill", label: "大量刷题" },
      { value: "deep", label: "精讲一题" },
    ],
  },
];

interface StudentModel {
  signals: string;
  notes: string | null;
  notesUpdatedAt: string | null;
}

export default function SettingsPage() {
  const [student, setStudent] = useState<StudentPublic | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [model, setModel] = useState<StudentModel | null>(null);
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    getJSON<StudentPublic>("/api/student").then(setStudent).catch(() => {});
    getJSON<Health>("/api/health").then(setHealth).catch(() => {});
    getJSON<StudentModel>("/api/student/model").then(setModel).catch(() => {});
  }, []);

  const showFlash = (text: string, ok: boolean) => {
    setFlash({ text, ok });
    setTimeout(() => setFlash(null), 2200);
  };

  const setPref = async (key: string, value: string) => {
    try {
      const s = await postJSON<StudentPublic>("/api/student/profile", { [key]: value });
      setStudent(s);
      showFlash("已保存", true);
    } catch {
      showFlash("保存失败:服务未连接", false);
    }
  };

  const reset = async () => {
    if (!window.confirm("重置会清空:对话记录、掌握度、错题本、偏好档案。确定吗?")) return;
    try {
      const s = await postJSON<StudentPublic>("/api/student/reset", {});
      setStudent(s);
      showFlash("已重置", true);
    } catch {
      showFlash("重置失败:服务未连接", false);
    }
  };

  return (
    <div className="page settings-page">
      <header className="page-head">
        <div>
          <h1>设置</h1>
          <div className="head-sub">老师的观察 · 系统状态</div>
        </div>
        {flash && <span className={flash.ok ? "saved-flash" : "saved-flash fail"}>{flash.text}</span>}
      </header>

      <div className="panel">
        <h2 className="panel-title">老师对你的了解</h2>
        <p className="panel-desc">
          这不是你填的表——是 Stellairs 在教你的过程中,一节课一节课观察、记下来的。它据此决定怎么教你,并且会随着更了解你而不断修正。
        </p>
        {model?.notes ? (
          <div className="teacher-notes">{model.notes}</div>
        ) : (
          <div className="teacher-notes teacher-notes-empty">
            我还不太了解你。多上几节课、多做几道题,我会慢慢摸清你的路子——哪种讲法让你开窍、你常卡在哪、要给你多少提示。
          </div>
        )}
        {model?.signals && <div className="teacher-signals">学情快照 · {model.signals}</div>}
        {model?.notesUpdatedAt && (
          <div className="teacher-notes-time">
            笔记更新于 {new Date(model.notesUpdatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </div>
        )}
      </div>

      <div className="panel">
        <h2 className="panel-title">入学起点</h2>
        <p className="panel-desc">
          你刚进来时的自述,只是老师了解你的起点——真正怎么教,以上面的观察为准。想临时纠正,对话里直接说(比如"别让我猜,直接讲")最快。
        </p>
        {QUESTIONS.map((qc) => (
          <div key={qc.key} className="pref-row">
            <span className="pref-label">{qc.title}</span>
            <div className="segmented">
              {qc.options.map((o) => (
                <button
                  key={o.value}
                  className={"segment" + (student?.styleProfile?.[qc.key] === o.value ? " on" : "")}
                  onClick={() => void setPref(qc.key, o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="panel">
        <h2 className="panel-title">大脑通道</h2>
        {health ? (
          <>
            <div className="pref-row">
              <span className="pref-label">当前通道</span>
              <span>
                {health.provider === "mock" && <b>演示通道</b>}
                {health.provider === "anthropic" && <b>正式大脑(Anthropic API)</b>}
                {health.provider === "claude-cli" && <b>Claude Code 本机通道</b>}
                {" · 模型 "}{health.model}
              </span>
            </div>
            {health.provider === "mock" && (
              <p className="panel-desc">
                演示通道不联网、不花钱,能完整演示教学流程(玻意耳定律一课)。拿到 API key 后:填进
                <code> server/config.json </code>的 <code>apiKey</code>,并把 <code>provider</code> 改为
                <code> "anthropic"</code>,重启即切换成真大脑——或者把 key 交给 Claude Code,它来配置。
              </p>
            )}
            {health.provider === "anthropic" && !health.hasKey && (
              <p className="panel-desc">API key 尚未配置,对话会提示配置方法。</p>
            )}
          </>
        ) : (
          <p className="panel-desc">服务未连接。</p>
        )}
      </div>

      <div className="panel">
        <h2 className="panel-title">访问码</h2>
        <p className="panel-desc">
          你的学习档案跟着访问码走:换设备或换浏览器时,输入同一个码就能继续自己的进度。多名学生共用一个网址时,各自用各自的码,互不干扰。
        </p>
        <div className="code-row">
          <span className="pref-label">当前访问码</span>
          <span className="code-current">{studentCode()}</span>
        </div>
        <div className="code-row" style={{ marginTop: 10 }}>
          <span className="pref-label">切换到别的码</span>
          <input
            className="code-input"
            placeholder="输入访问码"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const v = (e.target as HTMLInputElement).value.trim();
                if (v) {
                  setStudentCode(v.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24));
                  window.location.href = "/";
                }
              }
            }}
          />
          <span className="q-hint">输入后按 Enter,页面会重新加载</span>
        </div>
      </div>

      <div className="panel">
        <h2 className="panel-title">学习数据</h2>
        <p className="panel-desc">
          全部学习数据保存在本机 <code>data/student.json</code>,可以直接打开查看。
        </p>
        <button className="danger-btn" onClick={() => void reset()}>
          重置全部学习数据
        </button>
      </div>
    </div>
  );
}
