import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, Dumbbell, Gem, Heart, LockKeyhole, Mountain, MoonStar, Sprout, Sun, Sunrise, Sunset, X } from "lucide-react";
import { SpriteTile } from "../../../components/admin/CreatureSprite";
import { EvolutionAnimation, type EvolutionJob } from "../../../components/player/EvolutionAnimation";
import { periodAt } from "../../../hooks/useWorldClock";
import { defaultLayout, specFor } from "../../../components/world/layout";
import type { WorldCreature } from "../../../components/world/PlayerWorld";
import { EVOLVE_FROM, EVOLVE_TO, FORMS, SHOW_FORMS, STAGE_NAMES, byName, has3d, requirementsOf } from "./showcaseData";

const PlayerWorld = lazy(() => import("../../../components/world/PlayerWorld").then((m) => ({ default: m.PlayerWorld })));

export type ShowcasePage = "raise" | "evolve" | "collect" | "explore";
const PAGES: { id: ShowcasePage; label: string; Icon: typeof Heart; title: string; text: string }[] = [
  { id: "raise", label: "Raise", Icon: Heart, title: "Raise your reByter", text: "Feed it, play with it, care for it and train it. Every choice you make shapes how it grows, and it reacts to each one." },
  { id: "evolve", label: "Evolve", Icon: Sprout, title: "Evolve into something new", text: "How you raise it decides what it becomes. Meet a form's requirements and your reByter transforms into the next one." },
  { id: "collect", label: "Collect", Icon: Gem, title: "Collect them all", text: "Every form lives in the Atlas. Discover new reByters as they appear and fill your collection. The locked ones are still waiting to be found." },
  { id: "explore", label: "Explore", Icon: Mountain, title: "Your own floating island", text: "Your reByters live and wander on your island. Decorate it, grow it and watch them explore." },
];

const SPEC = specFor(7);
const toCreature = (form: (typeof FORMS)[number], key: string): WorldCreature => ({
  mint: `tour-${key}-${form.id}`,
  evolution: form,
  emote: null,
  happy: false,
  level: 1,
  stageName: STAGE_NAMES[form.stage] ?? "",
  fullness: 80,
  energy: 80,
  bond: 60,
});

/** The start screen's tour: four short looks at the real game, with a line each. */
export function Showcase({ page, onPage, onClose }: { page: ShowcasePage; onPage: (page: ShowcasePage) => void; onClose: () => void }) {
  const index = PAGES.findIndex((p) => p.id === page);
  const current = PAGES[index];
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="sc-backdrop" role="dialog" aria-modal="true" aria-label={current.title}>
      <div className="sc-card">
        <div className="sc-media">
          {page === "raise" && <RaiseScene />}
          {page === "evolve" && <EvolveScene />}
          {page === "collect" && <CollectScene />}
          {page === "explore" && <ExploreScene />}
          <div className="sc-top">
            <nav className="sc-tabs" aria-label="Tour">
              {PAGES.map(({ id, label, Icon }) => (
                <button key={id} type="button" className={id === page ? "on" : ""} onClick={() => onPage(id)} aria-current={id === page}>
                  <Icon /> <span>{label}</span>
                </button>
              ))}
            </nav>
            <button type="button" className="sc-close" onClick={onClose} aria-label="Close"><X /></button>
          </div>
        </div>
        <section className="sc-sheet">
          <h2>{current.title}</h2>
          <p>{current.text}</p>
          <div className="sc-dots" aria-hidden="true">{PAGES.map((p) => <i key={p.id} className={p.id === page ? "on" : ""} />)}</div>
          <button type="button" className="sc-next" onClick={() => (index < PAGES.length - 1 ? onPage(PAGES[index + 1].id) : onClose())}>
            <strong>{index < PAGES.length - 1 ? "Next" : "Done"}</strong>
            <ChevronRight />
          </button>
        </section>
      </div>
    </div>
  );
}

function WorldLoading() {
  return <div className="sc-loading" role="status">Loading…</div>;
}

/** The close-up of one reByter, doing what you can do with it: touch, play, care and feed it. */
const RAISE_STEPS = [
  { action: "touch", label: "Pet it", meal: null },
  { action: "play", label: "Play with it", meal: null },
  { action: "care", label: "Care for it", meal: null },
  { action: "feed", label: "Feed it", meal: { food: 3, tier: 1 } },
] as const;

function RaiseScene() {
  const star = useMemo(() => toCreature(byName("Finbit"), "raise"), []);
  const creatures = useMemo(() => [star], [star]);
  const layout = useMemo(() => ({ ...defaultLayout(creatures.map((c) => c.mint), SPEC), props: [] }), [creatures]);
  const [step, setStep] = useState(-1);
  const timer = useRef(0);
  useEffect(() => {
    timer.current = window.setTimeout(() => setStep(0), 2200);
    return () => window.clearTimeout(timer.current);
  }, []);
  const next = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStep((s) => (s + 1) % RAISE_STEPS.length), 900);
  };
  const now = step >= 0 ? RAISE_STEPS[step] : null;
  return (
    <>
      <Suspense fallback={<WorldLoading />}>
        <PlayerWorld
          creatures={creatures}
          initialLayout={layout}
          onCommitLayout={async () => undefined}
          period="Day"
          onSelect={() => undefined}
          focusMint={star.mint}
          action={now?.action ?? "idle"}
          meal={now?.meal ?? null}
          onActionComplete={next}
          editable={false}
          showcase
          size={7}
        />
      </Suspense>
      <div className="sc-caption" aria-live="polite">{RAISE_STEPS.map((s, i) => <span key={s.action} className={i === step ? "on" : ""}>{s.label}</span>)}</div>
    </>
  );
}

/** What a form asks for, then the real evolution sequence, over and over. */
function EvolveScene() {
  const [phase, setPhase] = useState<"need" | "fx">("need");
  const [run, setRun] = useState(0);
  const [shown, setShown] = useState(0);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const needs = useMemo(() => requirementsOf(EVOLVE_FROM, EVOLVE_TO), []);
  useEffect(() => {
    if (phase !== "need") return;
    setShown(0);
    const ticks = needs.map((_, i) => window.setTimeout(() => setShown(i + 1), 700 + i * 650));
    const go = window.setTimeout(() => setPhase("fx"), 900 + needs.length * 650 + 800);
    return () => [...ticks, go].forEach(window.clearTimeout);
  }, [phase, needs, run]);
  const job = useMemo<EvolutionJob | null>(
    () => (phase === "fx" ? { from: EVOLVE_FROM, to: EVOLVE_TO, task: new Promise((r) => window.setTimeout(r, 1500)) } : null),
    [phase, run],
  );
  return (
    <div className="sc-evolve" ref={setHost}>
      {phase === "need" && (
        <div className="sc-need">
          <div className="sc-need-forms">
            <span><img src={EVOLVE_FROM.assets?.thumbnailUri} alt="" /><small>{EVOLVE_FROM.name}</small></span>
            <ChevronRight />
            <span><img src={EVOLVE_TO.assets?.thumbnailUri} alt="" /><small>{EVOLVE_TO.name}</small></span>
          </div>
          <h3>Evolution requirements</h3>
          <ul>
            {needs.map((need, i) => (
              <li key={need} className={i < shown ? "ok" : ""}>
                <span>{i < shown ? <Check /> : <Dumbbell />}</span>
                {need}
              </li>
            ))}
          </ul>
        </div>
      )}
      {job && host && <EvolutionAnimation key={run} job={job} stageNames={STAGE_NAMES} container={host} demo onClose={() => { setRun((r) => r + 1); setPhase("need"); }} />}
    </div>
  );
}

/** The Atlas: the forms that already exist in 3D, and the rest still locked. */
function CollectScene() {
  const sorted = useMemo(() => [...FORMS].sort((a, b) => Number(has3d(b)) - Number(has3d(a)) || a.stage - b.stage || a.id - b.id), []);
  const found = FORMS.filter(has3d).length;
  return (
    <div className="sc-atlas">
      <header><strong>Atlas</strong><small>{found} of {FORMS.length} discovered</small></header>
      <div className="sc-atlas-grid">
        {sorted.map((form) => {
          const open = has3d(form);
          return (
            <div key={form.id} className={`sc-form${open ? " open" : ""}`}>
              {open ? <SpriteTile evolution={form} /> : <LockKeyhole />}
              <small>{open ? form.name : "???"}</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The island with its reByters walking around. */
function WorldClockChip() {
  // The waitlist page has no wallet/connection context, so this ticks from the device's own UTC clock.
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const clock = { now, period: periodAt(now) };
  const Icon = clock.period === "Night" ? MoonStar : clock.period === "Day" ? Sun : clock.period === "Morning" ? Sunrise : Sunset;
  return (
    <div className="world-clock gl-panel sc-clock" aria-label="World time">
      <span className={`world-clock-face ${clock.period.toLowerCase()}`} aria-hidden="true"><Icon /></span>
      <span><strong>{clock.period}</strong><small>{new Date(clock.now).toISOString().slice(11, 16)} UTC</small></span>
    </div>
  );
}

function ExploreScene() {
  const creatures = useMemo(() => SHOW_FORMS.slice(0, SPEC.maxPlaced).map((f) => toCreature(f, "island")), []);
  const layout = useMemo(() => defaultLayout(creatures.map((c) => c.mint), SPEC), [creatures]);
  return (
    <>
    <WorldClockChip />
    <Suspense fallback={<WorldLoading />}>
      <PlayerWorld
        creatures={creatures}
        initialLayout={layout}
        onCommitLayout={async () => undefined}
        period="Day"
        onSelect={() => undefined}
        editable={false}
        showcase
        tour
        size={7}
      />
    </Suspense>
    </>
  );
}
