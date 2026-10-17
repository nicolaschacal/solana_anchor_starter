import { Suspense, lazy, useMemo, useState } from "react";
import { X } from "lucide-react";
import { SpriteTile } from "../../components/admin/CreatureSprite";
import { defaultLayout, specFor } from "../../components/world/layout";
import type { WorldCreature } from "../../components/world/PlayerWorld";
import type { Evolution } from "../../lib/rebyters/types";

const PlayerWorld = lazy(() => import("../../components/world/PlayerWorld").then((m) => ({ default: m.PlayerWorld })));

const STAGES = ["Bit", "Byte", "Kylo", "Mega", "Giga", "Tera"];
const SPEC = specFor(5);
const ACTIONS = [
  { id: "idle", label: "Idle" },
  { id: "touch", label: "Pet" },
  { id: "play", label: "Play" },
  { id: "care", label: "Care" },
  { id: "sad", label: "Sad" },
] as const;

const asCreature = (form: Evolution): WorldCreature => ({
  mint: `preview-${form.id}`,
  evolution: form,
  emote: null,
  happy: false,
  level: form.stage + 1,
  stageName: STAGES[form.stage] ?? "",
  fullness: 80,
  energy: 80,
  bond: 60,
});

/** Admin only, nothing is saved or sent: pick any form of the atlas and see it on screen, with its animations. */
export function FreePreview({ forms, onClose }: { forms: Evolution[]; onClose: () => void }) {
  const list = useMemo(() => forms.filter((f) => f.stage > 0), [forms]);
  const [formId, setFormId] = useState(list[0]?.id);
  const [stage, setStage] = useState<number | null>(null);
  const [action, setAction] = useState<string>("idle");
  const [close, setClose] = useState(true);
  const form = list.find((f) => f.id === formId);
  const shown = list.filter((f) => stage === null || f.stage === stage);
  const creatures = useMemo(() => (form ? [asCreature(form)] : []), [form]);
  const layout = useMemo(() => ({ ...defaultLayout(creatures.map((c) => c.mint), SPEC), props: [] }), [creatures]);
  return (
    <div className="ap-backdrop" role="dialog" aria-modal="true" aria-label="Form preview">
      <div className="ap-card">
        <div className="ap-stage">
          {form && (
            <Suspense fallback={null}>
              <PlayerWorld
                key={`${form.id}-${close}`}
                creatures={creatures}
                initialLayout={layout}
                onCommitLayout={async () => undefined}
                period="Day"
                onSelect={() => setClose((c) => !c)}
                focusMint={close ? creatures[0].mint : null}
                action={action}
                onActionComplete={() => setAction("idle")}
                editable={false}
                showcase
                size={5}
              />
            </Suspense>
          )}
          <div className="ap-top">
            <strong>{form ? `${form.name} · ${STAGES[form.stage]}` : "Preview"}</strong>
            <button type="button" onClick={onClose} aria-label="Close"><X /></button>
          </div>
          <div className="ap-actions">
            {ACTIONS.map((a) => (
              <button key={a.id} type="button" className={action === a.id ? "on" : ""} onClick={() => setAction(a.id)}>{a.label}</button>
            ))}
            <button type="button" onClick={() => setClose((c) => !c)}>{close ? "Island" : "Close-up"}</button>
          </div>
        </div>
        <div className="ap-pick">
          <div className="ap-stages">
            <button type="button" className={stage === null ? "on" : ""} onClick={() => setStage(null)}>All</button>
            {STAGES.slice(1).map((name, i) => (
              <button key={name} type="button" className={stage === i + 1 ? "on" : ""} onClick={() => setStage(i + 1)}>{name}</button>
            ))}
          </div>
          <div className="ap-forms">
            {shown.map((f) => (
              <button key={f.id} type="button" className={f.id === formId ? "on" : ""} onClick={() => { setFormId(f.id); setAction("idle"); }} aria-label={f.name}>
                <SpriteTile evolution={f} />
                <small>{f.name}</small>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
