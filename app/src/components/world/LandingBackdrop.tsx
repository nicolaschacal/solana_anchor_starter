import { useEffect, useRef } from "react";

/** The sign-in postcard: an illustrated island that follows the game clock (day / night), with a barely-there
 *  parallax drift and a few floating specks (pollen by day, fireflies by night) drawn over it. */
export function LandingBackdrop({ night }: { night: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const nightRef = useRef(night);
  nightRef.current = night;

  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const el = root.current, cv = canvas.current;
    if (!el || !cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    let w = 0, h = 0, raf = 0, last = performance.now();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      w = el.clientWidth; h = el.clientHeight;
      cv.width = w * dpr; cv.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);
    type P = { x: number; y: number; r: number; vx: number; vy: number; ph: number; sp: number };
    const spawn = (anywhere: boolean): P => ({
      x: anywhere ? Math.random() * w : -10, y: Math.random() * h * 0.8,
      r: 0.8 + Math.random() * 1.8, vx: 8 + Math.random() * 16, vy: -2 - Math.random() * 5,
      ph: Math.random() * 6.28, sp: 0.5 + Math.random(),
    });
    const parts = Array.from({ length: 26 }, () => spawn(true));
    // Pointer / tilt parallax, eased, a few pixels at most.
    let tx = 0, ty = 0, cx = 0, cy = 0;
    const onMove = (e: PointerEvent) => { tx = (e.clientX / innerWidth - 0.5) * 2; ty = (e.clientY / innerHeight - 0.5) * 2; };
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      tx = Math.max(-1, Math.min(1, e.gamma / 25)); ty = Math.max(-1, Math.min(1, (e.beta - 45) / 25));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("deviceorientation", onTilt);
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      cx += (tx - cx) * 0.04; cy += (ty - cy) * 0.04;
      el.style.setProperty("--px", `${(-cx * 7).toFixed(2)}px`);
      el.style.setProperty("--py", `${(-cy * 5).toFixed(2)}px`);
      ctx.clearRect(0, 0, w, h);
      const isNight = nightRef.current;
      for (const p of parts) {
        p.ph += dt * p.sp;
        p.x += (p.vx + Math.sin(p.ph) * 6) * dt * (isNight ? 0.5 : 1);
        p.y += (p.vy + Math.cos(p.ph * 0.8) * 5) * dt;
        if (p.x > w + 10 || p.y < -10 || p.y > h) Object.assign(p, spawn(false));
        const tw = isNight ? 0.35 + 0.65 * Math.abs(Math.sin(p.ph * 1.6)) : 0.55;
        ctx.beginPath();
        ctx.fillStyle = isNight ? `rgba(255,224,130,${tw})` : `rgba(255,255,255,${tw})`;
        ctx.shadowColor = isNight ? "rgba(255,200,80,.9)" : "rgba(255,255,255,.8)";
        ctx.shadowBlur = isNight ? 10 : 5;
        ctx.arc(p.x, p.y, p.r * (isNight ? 1.15 : 1), 0, 6.283);
        ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    };
    if (reduced) { el.style.setProperty("--px", "0px"); el.style.setProperty("--py", "0px"); }
    else raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("deviceorientation", onTilt);
    };
  }, []);

  return (
    <div className="landing-backdrop" ref={root} aria-hidden="true">
      <div className="landing-art">
        <img className={night ? "" : "on"} src="/landing/day.webp" alt="" decoding="async" />
        <img className={night ? "on" : ""} src="/landing/night.webp" alt="" decoding="async" />
      </div>
      <canvas ref={canvas} />
    </div>
  );
}
