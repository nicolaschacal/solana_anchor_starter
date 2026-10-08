import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import type { Evolution } from "../../lib/rebyters/types";
import { EvolutionFx, type FxUi } from "../../lib/rebyters/evolution-fx";
import { birthSeed, loadEvolutionAsset } from "./creatureAsset";

export type EvolutionJob = {
  /** The form it evolves from. `null` when a new Rebyter is minted: it is born from a seed. */
  from: Evolution | null;
  to: Evolution;
  /** The evolve transaction. The animation holds its helix until this settles. */
  task: Promise<unknown>;
};

type Outcome = "pending" | "ok" | "failed";
const FADE_OUT_MS = 320;

/**
 * Full-screen 3D evolution animation. It starts the moment the player presses
 * Evolve, holds the DNA helix while the transaction is confirmed, plays the
 * flash and the recompile when it succeeds, and fades out if it fails.
 */
export function EvolutionAnimation({
  job,
  stageNames,
  onClose,
}: {
  job: EvolutionJob;
  stageNames: readonly string[];
  onClose: () => void;
}) {
  const { from, to } = job;
  const birth = from === null;
  const fromStage = from?.stage ?? to.stage;
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLOListElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const fxRef = useRef<EvolutionFx | null>(null);
  const outcome = useRef<Outcome>("pending");
  const revealed = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [leaving, setLeaving] = useState(false);
  const [ready, setReady] = useState(false);

  // Follow the transaction.
  useEffect(() => {
    let live = true;
    job.task.then(
      () => {
        if (live) outcome.current = "ok";
      },
      () => {
        if (live) outcome.current = "failed";
      },
    );
    return () => {
      live = false;
    };
  }, [job]);

  // Focus: move into the overlay and give it back afterwards.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    rootRef.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  // The animation loop. A layout effect, so the stage is drawn in the same frame the overlay appears.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const banner = bannerRef.current;
    const status = statusRef.current;
    const rail = railRef.current;
    if (!stage || !banner || !status || !rail) return;

    let cancelled = false;
    let raf = 0;
    let timer = 0;
    let last = 0;
    let shownStage = -1;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    const paint = (ui: FxUi) => {
      banner.style.opacity = String(ui.reveal);
      banner.style.transform = `translateY(${(1 - ui.reveal) * 14}px)`;
      banner.style.pointerEvents = ui.reveal > 0.9 ? "auto" : "none";
      status.dataset.visible = String(ui.waiting);
      if (ui.reveal > 0.9 && !revealed.current) {
        revealed.current = true;
        setReady(true);
      }
      const now = ui.stageReached ? to.stage : fromStage;
      if (now !== shownStage) {
        shownStage = now;
        [...rail.children].forEach((li, i) => {
          (li as HTMLElement).dataset.state = i < now ? "done" : i === now ? "now" : "todo";
        });
      }
    };

    const leave = () => {
      setLeaving(true);
      timer = window.setTimeout(() => closeRef.current(), FADE_OUT_MS);
    };

    // No animation possible on this device: wait for the chain and step aside.
    const abandon = async () => {
      await job.task.catch(() => undefined);
      if (!cancelled) closeRef.current();
    };

    // The stage is drawn right now. The creatures arrive as they load and the
    // sequence starts once the first one is on stage.
    const canvas = document.createElement("canvas");
    stage.append(canvas);
    let fx: EvolutionFx | null = null;
    try {
      fx = new EvolutionFx(canvas, { fromStage, toStage: to.stage, reducedMotion: reduced });
    } catch {
      void abandon();
    }
    if (fx) {
      const live = fx;
      fxRef.current = live;
      (from ? loadEvolutionAsset(from) : Promise.resolve(birthSeed())).then(
        (asset) => !cancelled && live.setFrom(asset),
        () => void abandon(),
      );
      loadEvolutionAsset(to).then((asset) => !cancelled && live.setTo(asset), () => void abandon());
      const frame = (now: number) => {
        if (cancelled) return;
        if (outcome.current === "failed") {
          leave();
          return;
        }
        const dt = Math.min(0.05, (now - (last || now)) / 1000);
        last = now;
        live.advance(dt, outcome.current === "ok");
        live.render();
        paint(live.ui);
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    }

    const onResize = () => fxRef.current?.resize();
    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      window.removeEventListener("resize", onResize);
      fxRef.current = null;
      fx?.dispose();
      canvas.remove();
    };
  }, [from, fromStage, to, job]);

  // Continue is a real React prop, so React still delivers its clicks.
  useEffect(() => {
    if (ready) continueRef.current?.focus();
  }, [ready]);

  // Keys: the overlay is modal, so it handles Escape and Tab before the panel behind it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        // The sequence cannot be skipped; once it has finished, Escape is Continue.
        if (revealed.current) closeRef.current();
      } else if (event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        const button = continueRef.current;
        (button && !button.disabled ? button : rootRef.current)?.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const label = (stage: number) => stageNames[stage] ?? "";
  return createPortal(
    <div
      ref={rootRef}
      className="rb-ui evo-fx"
      role="dialog"
      aria-modal="true"
      aria-label={birth ? "New Rebyter" : "Evolution"}
      tabIndex={-1}
      data-leaving={leaving}
    >
      <div className="evo-stage" ref={stageRef} aria-hidden="true" />
      <div className="evo-status" ref={statusRef} role="status" data-visible="false">
        Confirming on Solana…
      </div>
      <div className="evo-banner" ref={bannerRef} style={{ opacity: 0, pointerEvents: "none" }}>
        <div className="evo-kicker">
          {birth ? "New Rebyter" : `Evolved · ${label(fromStage)} → ${label(to.stage)}`}
        </div>
        <div className="evo-name" role="heading" aria-level={2}>
          {to.name}
        </div>
        <div className="evo-sub">{from ? `Evolved from ${from.name}` : "Born on Solana"}</div>
        <ol className="evo-rail" ref={railRef} aria-label="Stage">
          {stageNames.map((name, i) => (
            <li key={name} data-state={i < fromStage ? "done" : i === fromStage ? "now" : "todo"}>
              {name}
            </li>
          ))}
        </ol>
        <button ref={continueRef} className="ui-btn ui-btn-primary" type="button" disabled={!ready} onClick={onClose}>
          Continue
        </button>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Owns the animation for a screen. Call `play` with the evolve transaction the
 * moment the player presses Evolve, and render `overlay` next to the screen.
 */
export function useEvolutionAnimation(stageNames: readonly string[]): {
  play: (from: Evolution | null, to: Evolution, task: Promise<unknown>) => void;
  overlay: ReactElement | null;
} {
  const [job, setJob] = useState<EvolutionJob | null>(null);
  const play = useCallback((from: Evolution | null, to: Evolution, task: Promise<unknown>) => {
    setJob((current) => current ?? { from, to, task });
  }, []);
  const close = useCallback(() => setJob(null), []);
  return {
    play,
    overlay: job ? <EvolutionAnimation job={job} stageNames={stageNames} onClose={close} /> : null,
  };
}
