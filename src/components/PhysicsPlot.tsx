// 物理示意图渲染器:AI 只填参数(一个 JSON spec),这里把它画成矢量图。
// 支持 p-V 等温线、p-1/V 直线、V-T/p-T 直线、F-r/Ep-r 示意曲线、循环过程(状态点+过程箭头+做功阴影)。
// 用法:markdown 里出现 ```plot\n{...spec...}\n``` 代码块时,Md.tsx 会调用本组件。

export interface PlotSpec {
  title?: string;
  xlabel?: string;
  ylabel?: string;
  xmin?: number;
  xmax?: number;
  ymin?: number;
  ymax?: number;
  curves?: PlotCurve[];
  points?: PlotPoint[];
  segments?: PlotSegment[];
  shade?: PlotShade[];
}
export type PlotCurve =
  | { type: "isotherm"; k: number; label?: string; color?: string; dashed?: boolean; from?: number; to?: number }
  | { type: "line"; m: number; b: number; label?: string; color?: string; dashed?: boolean; from?: number; to?: number }
  | { type: "curve"; data: [number, number][]; label?: string; color?: string; dashed?: boolean; smooth?: boolean };
export interface PlotPoint { x: number; y: number; label?: string }
export interface PlotSegment { from: [number, number] | string; to: [number, number] | string; color?: string; dashed?: boolean; arrow?: boolean; label?: string }
export interface PlotShade { points: [number, number][]; toAxis?: boolean; color?: string }

const W = 460, H = 320;
const ML = 52, MR = 30, MT_BASE = 22, MB = 46;

const PALETTE: Record<string, string> = {
  red: "#d1402f", blue: "#2f6fd8", teal: "#1f8f80", gold: "#c98a1e",
  purple: "#7a4fd0", green: "#3a9a4e", ink: "#26303f",
};
const CYCLE = ["#d1402f", "#2f6fd8", "#1f8f80", "#7a4fd0", "#c98a1e"];
function col(name: string | undefined, i = 0): string {
  if (name && PALETTE[name]) return PALETTE[name];
  if (name && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(name)) return name;
  return CYCLE[i % CYCLE.length];
}

const num = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : null);

export default function PhysicsPlot({ spec }: { spec: PlotSpec }) {
  try {
    return <Plot spec={spec} />;
  } catch {
    return <div className="plot-fallback">（示意图参数有误,无法绘制）</div>;
  }
}

function Plot({ spec }: { spec: PlotSpec }) {
  const MT = spec.title ? MT_BASE + 18 : MT_BASE;
  const plotW = W - ML - MR;
  const plotH = H - MT - MB;

  // —— 采样每条曲线 ——
  const sampled: { pts: [number, number][]; color: string; dashed?: boolean; label?: string; smooth?: boolean }[] = [];
  (spec.curves ?? []).forEach((c, i) => {
    const color = col(c.color, i);
    if (c.type === "isotherm") {
      const k = num(c.k);
      if (k === null) return;
      const from = num(c.from) ?? spec.xmin ?? undefined;
      sampled.push({ pts: sampleFn((x) => k / x, from, num(c.to) ?? undefined, spec), color, dashed: c.dashed, label: c.label });
    } else if (c.type === "line") {
      const m = num(c.m), b = num(c.b);
      if (m === null || b === null) return;
      sampled.push({ pts: sampleFn((x) => m * x + b, num(c.from) ?? undefined, num(c.to) ?? undefined, spec), color, dashed: c.dashed, label: c.label });
    } else if (c.type === "curve" && Array.isArray(c.data)) {
      const pts = c.data.filter((p) => Array.isArray(p) && num(p[0]) !== null && num(p[1]) !== null) as [number, number][];
      sampled.push({ pts, color, dashed: c.dashed, label: c.label, smooth: c.smooth });
    }
  });

  const points = (spec.points ?? []).filter((p) => num(p.x) !== null && num(p.y) !== null);
  const namedPoints: Record<string, [number, number]> = {};
  for (const p of points) if (p.label) namedPoints[p.label] = [p.x, p.y];
  const resolve = (r: [number, number] | string): [number, number] | null => {
    if (typeof r === "string") return namedPoints[r] ?? null;
    return num(r?.[0]) !== null && num(r?.[1]) !== null ? [r[0], r[1]] : null;
  };
  const segs = (spec.segments ?? [])
    .map((s) => ({ a: resolve(s.from), b: resolve(s.to), color: s.color, dashed: s.dashed, arrow: s.arrow !== false, label: s.label }))
    .filter((s) => s.a && s.b) as { a: [number, number]; b: [number, number]; color?: string; dashed?: boolean; arrow: boolean; label?: string }[];
  const shades = (spec.shade ?? []).filter((s) => Array.isArray(s.points) && s.points.length >= 2);

  // —— 数据范围(缺省自动;正数量默认从 0 起)——
  const xs: number[] = [], ys: number[] = [];
  const eat = (p: [number, number]) => { xs.push(p[0]); ys.push(p[1]); };
  sampled.forEach((c) => c.pts.forEach(eat));
  points.forEach((p) => eat([p.x, p.y]));
  segs.forEach((s) => { eat(s.a); eat(s.b); });
  shades.forEach((s) => s.points.forEach((p) => eat(p as [number, number])));
  if (xs.length === 0) return <div className="plot-fallback">（示意图缺少数据）</div>;

  let xmin = num(spec.xmin) ?? Math.min(...xs);
  let xmax = num(spec.xmax) ?? Math.max(...xs);
  let ymin = num(spec.ymin) ?? Math.min(...ys);
  let ymax = num(spec.ymax) ?? Math.max(...ys);
  if (num(spec.xmin) === null && xmin > 0) xmin = 0;
  if (num(spec.ymin) === null && ymin > 0) ymin = 0;
  if (num(spec.xmax) === null) xmax += (xmax - xmin) * 0.08 || 1;
  if (num(spec.ymax) === null) ymax += (ymax - ymin) * 0.1 || 1;
  if (xmax - xmin < 1e-9) xmax = xmin + 1;
  if (ymax - ymin < 1e-9) ymax = ymin + 1;

  const sx = (x: number) => ML + ((x - xmin) / (xmax - xmin)) * plotW;
  const sy = (y: number) => MT + plotH - ((y - ymin) / (ymax - ymin)) * plotH;
  const clampX = (x: number) => Math.max(xmin, Math.min(xmax, x));
  const clampY = (y: number) => Math.max(ymin, Math.min(ymax, y));

  const originY = ymin < 0 && ymax > 0 ? 0 : ymin; // F-r 图把横轴放在 y=0
  const axisY = sy(originY);
  const axisX = sx(xmin);

  const toPath = (pts: [number, number][], smooth?: boolean) => {
    const P = pts
      .filter((p) => p[0] >= xmin - 1e-9 && p[0] <= xmax + 1e-9)
      .map((p) => [sx(clampX(p[0])), sy(clampY(p[1]))] as [number, number]);
    if (P.length < 2) return "";
    if (!smooth) return "M" + P.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" L ");
    // Catmull-Rom → 三次贝塞尔
    let d = `M${P[0][0].toFixed(1)} ${P[0][1].toFixed(1)}`;
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[i - 1] ?? P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] ?? P[i + 1];
      const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    return d;
  };

  return (
    <div className="physics-plot">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={spec.title ?? "物理示意图"} preserveAspectRatio="xMidYMid meet">
        <defs>
          <marker id="pp-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4" orient="auto">
            <path d="M0 0 L8 4 L0 8 z" fill="#26303f" />
          </marker>
        </defs>
        <rect x="0" y="0" width={W} height={H} rx="10" fill="#f6f8fc" />
        {spec.title && <text x={W / 2} y={20} textAnchor="middle" className="pp-title">{spec.title}</text>}

        {/* 做功阴影 */}
        {shades.map((s, i) => {
          const pts = s.points.map((p) => [sx(clampX(p[0])), sy(clampY(p[1]))] as [number, number]);
          const close = s.toAxis
            ? [...pts, [sx(clampX(s.points[s.points.length - 1][0])), axisY], [sx(clampX(s.points[0][0])), axisY]]
            : pts;
          const d = "M" + close.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" L ") + " Z";
          return <path key={"sh" + i} d={d} fill={col(s.color, i)} opacity={0.14} stroke="none" />;
        })}

        {/* 坐标轴 */}
        <line x1={axisX} y1={sy(ymin)} x2={axisX} y2={MT - 6} className="pp-axis" markerEnd="url(#pp-arrow)" />
        <line x1={axisX} y1={axisY} x2={ML + plotW + 6} y2={axisY} className="pp-axis" markerEnd="url(#pp-arrow)" />
        {spec.ylabel && <text x={axisX - 8} y={MT - 10} textAnchor="end" className="pp-axislabel">{spec.ylabel}</text>}
        {spec.xlabel && <text x={ML + plotW + 8} y={axisY + 4} textAnchor="start" className="pp-axislabel">{spec.xlabel}</text>}
        <text x={axisX - 7} y={sy(ymin) + 4} textAnchor="end" className="pp-o">O</text>

        {/* 曲线 */}
        {sampled.map((c, i) => {
          const d = toPath(c.pts, c.smooth);
          if (!d) return null;
          const last = c.pts[c.pts.length - 1];
          return (
            <g key={"c" + i}>
              <path d={d} fill="none" stroke={c.color} strokeWidth={2} strokeDasharray={c.dashed ? "5 4" : undefined} strokeLinecap="round" />
              {c.label && last && (
                <text x={sx(clampX(last[0])) - 4} y={sy(clampY(last[1])) - 6} textAnchor="end" className="pp-curvelabel" fill={c.color}>{c.label}</text>
              )}
            </g>
          );
        })}

        {/* 过程箭头 */}
        {segs.map((s, i) => (
          <g key={"s" + i}>
            <line x1={sx(clampX(s.a[0]))} y1={sy(clampY(s.a[1]))} x2={sx(clampX(s.b[0]))} y2={sy(clampY(s.b[1]))}
              stroke={col(s.color, i)} strokeWidth={2} strokeDasharray={s.dashed ? "5 4" : undefined}
              markerEnd={s.arrow ? "url(#pp-arrow)" : undefined} />
            {s.label && (
              <text x={(sx(clampX(s.a[0])) + sx(clampX(s.b[0]))) / 2} y={(sy(clampY(s.a[1])) + sy(clampY(s.b[1]))) / 2 - 5}
                textAnchor="middle" className="pp-curvelabel" fill={col(s.color, i)}>{s.label}</text>
            )}
          </g>
        ))}

        {/* 状态点 */}
        {points.map((p, i) => (
          <g key={"p" + i}>
            <circle cx={sx(clampX(p.x))} cy={sy(clampY(p.y))} r={3.6} fill="#26303f" />
            {p.label && <text x={sx(clampX(p.x)) + 7} y={sy(clampY(p.y)) - 6} className="pp-pointlabel">{p.label}</text>}
          </g>
        ))}
      </svg>
    </div>
  );
}

// 在数据 x 范围内采样一个函数
function sampleFn(f: (x: number) => number, from: number | undefined, to: number | undefined, spec: PlotSpec): [number, number][] {
  const lo = num(from) ?? num(spec.xmin) ?? 0.0001;
  const hi = num(to) ?? num(spec.xmax) ?? (lo > 0 ? lo * 10 : lo + 10);
  const a = Math.min(lo, hi) || 0.0001;
  const b = Math.max(lo, hi);
  const N = 64;
  const out: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const x = a + ((b - a) * i) / N;
    if (Math.abs(x) < 1e-9) continue;
    const y = f(x);
    if (isFinite(y)) out.push([x, y]);
  }
  return out;
}
