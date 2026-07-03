import { useEffect, useRef } from "react";
import moonBackdrop from "../assets/stellairs-galaxy-moon-hd.webp";

type Star = {
  x: number;
  y: number;
  r: number;
  phase: number;
  speed: number;
  color: string;
};

type Meteor = {
  x: number;
  y: number;
  length: number;
  speed: number;
  angle: number;
  wait: number;
  alpha: number;
  color: string;
};

const STAR_COLORS = ["#ffffff", "#dff7ff", "#ffe5ad", "#e7d3ff", "#ffc3d0"];
const METEOR_COLORS = ["#effaff", "#ffd88c", "#f2d8ff", "#91ecff"];

function between(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function makeMeteor(width: number, height: number, wait = between(0, 5200)): Meteor {
  return {
    x: between(width * 0.02, width * 0.86),
    y: between(-height * 0.32, height * 0.38),
    length: between(150, 360),
    speed: between(8, 15),
    angle: between(0.54, 0.72),
    wait,
    alpha: between(0.44, 0.86),
    color: METEOR_COLORS[Math.floor(Math.random() * METEOR_COLORS.length)],
  };
}

export default function CosmicBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let frame = 0;
    let last = performance.now();
    let raf = 0;
    let stars: Star[] = [];
    let meteors: Meteor[] = [];

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const starCount = Math.min(340, Math.max(150, Math.floor((width * height) / 5200)));
      stars = Array.from({ length: starCount }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: between(0.35, 1.45),
        phase: Math.random() * Math.PI * 2,
        speed: between(0.00045, 0.0018),
        color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
      }));

      meteors = [makeMeteor(width, height, 200), makeMeteor(width, height, 2300), makeMeteor(width, height, 4700)];
    };

    const draw = (now: number) => {
      const dt = Math.min(34, now - last);
      last = now;
      frame += dt;
      ctx.clearRect(0, 0, width, height);

      for (const star of stars) {
        const pulse = 0.5 + Math.sin(frame * star.speed + star.phase) * 0.28;
        ctx.globalAlpha = Math.max(0.16, pulse);
        ctx.fillStyle = star.color;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!reduceMotion) {
        for (let i = 0; i < meteors.length; i += 1) {
          const meteor = meteors[i];
          if (meteor.wait > 0) {
            meteor.wait -= dt;
            continue;
          }

          meteor.x += Math.cos(meteor.angle) * meteor.speed * (dt / 16.67);
          meteor.y += Math.sin(meteor.angle) * meteor.speed * (dt / 16.67);

          const tailX = meteor.x - Math.cos(meteor.angle) * meteor.length;
          const tailY = meteor.y - Math.sin(meteor.angle) * meteor.length;
          const gradient = ctx.createLinearGradient(tailX, tailY, meteor.x, meteor.y);
          gradient.addColorStop(0, "rgba(255,255,255,0)");
          gradient.addColorStop(0.42, `${meteor.color}55`);
          gradient.addColorStop(1, meteor.color);

          ctx.globalAlpha = meteor.alpha;
          ctx.strokeStyle = gradient;
          ctx.lineWidth = between(1.05, 1.85);
          ctx.beginPath();
          ctx.moveTo(tailX, tailY);
          ctx.lineTo(meteor.x, meteor.y);
          ctx.stroke();

          ctx.globalAlpha = Math.min(1, meteor.alpha + 0.14);
          ctx.fillStyle = meteor.color;
          ctx.beginPath();
          ctx.arc(meteor.x, meteor.y, 1.55, 0, Math.PI * 2);
          ctx.fill();

          if (meteor.x > width + meteor.length || meteor.y > height + meteor.length) {
            meteors[i] = makeMeteor(width, height, between(900, 5400));
          }
        }
      }

      ctx.globalAlpha = 1;
      raf = window.requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    raf = window.requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      window.cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="cosmic-backdrop" aria-hidden="true">
      <img className="cosmic-moon" src={moonBackdrop} alt="" />
      <div className="cosmic-aura cosmic-aura-rose" />
      <div className="cosmic-aura cosmic-aura-gold" />
      <div className="cosmic-aura cosmic-aura-cyan" />
      <canvas className="cosmic-canvas" ref={canvasRef} />
    </div>
  );
}
