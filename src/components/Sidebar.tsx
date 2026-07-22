import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { getJSON } from "../lib/api";
import type { Health } from "../lib/types";

const NAV = [
  { to: "/", label: "对话", icon: IconChat },
  { to: "/map", label: "学习地图", icon: IconMap },
  { to: "/practice", label: "练习", icon: IconPen },
  { to: "/mistakes", label: "错题本", icon: IconBook },
  { to: "/settings", label: "设置", icon: IconGear },
];

export default function Sidebar() {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    getJSON<Health>("/api/health").then(setHealth).catch(() => setHealth(null));
  }, []);

  const providerLabel =
    health == null
      ? "服务未连接"
      : health.provider === "mock"
        ? "演示通道"
        : health.provider === "anthropic"
          ? health.hasKey
            ? "正式大脑"
            : "等待 API key"
          : "Claude Code 通道";

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-star">✦</span>
        <div>
          <div className="brand-name">Stellairs</div>
          <div className="brand-sub">高考物理私教</div>
        </div>
      </div>

      <nav className="nav">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}>
            <Icon />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-foot">
        <div className={"provider-pill" + (health?.provider === "mock" ? " mock" : "")}>
          <span className="dot" />
          {providerLabel}
        </div>
        <div className="scope-note">选必三 · 热学+原子物理</div>
      </div>
    </aside>
  );
}

/** 手机端底部标签栏(≤760px 显示,替代侧栏) */
export function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="主导航">
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => "bn-item" + (isActive ? " active" : "")}>
          <Icon />
          <span>{label === "学习地图" ? "地图" : label === "错题本" ? "错题" : label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function IconChat() {
  return (
    <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 5.5A2.5 2.5 0 015.5 3h9A2.5 2.5 0 0117 5.5v6a2.5 2.5 0 01-2.5 2.5H8l-4 3v-3h-.5A2.5 2.5 0 013 11.5v-6z" strokeLinejoin="round" />
    </svg>
  );
}
function IconMap() {
  return (
    <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="6" height="6" rx="1.2" />
      <rect x="11" y="3" width="6" height="6" rx="1.2" />
      <rect x="3" y="11" width="6" height="6" rx="1.2" />
      <rect x="11" y="11" width="6" height="6" rx="1.2" />
    </svg>
  );
}
function IconPen() {
  return (
    <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M13.5 3.5l3 3L7 16H4v-3l9.5-9.5z" strokeLinejoin="round" />
    </svg>
  );
}
function IconBook() {
  return (
    <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 4a1.5 1.5 0 011.5-1.5H16v14H5.5A1.5 1.5 0 004 18V4z" strokeLinejoin="round" />
      <path d="M4 15.5A1.5 1.5 0 015.5 14H16" />
    </svg>
  );
}
function IconGear() {
  return (
    <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 2.8v2m0 10.4v2M17.2 10h-2M4.8 10h-2m11.3-5.1l-1.4 1.4M7.3 12.7l-1.4 1.4m0-8.2l1.4 1.4m5.4 5.4l1.4 1.4" strokeLinecap="round" />
    </svg>
  );
}
